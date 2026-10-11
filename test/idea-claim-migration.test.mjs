import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { up, down } from "../cinatra/migrations/ext_cinatra-ai_blog-pipeline-agent__0001_backfill-idea-claims.mjs";

// Recording queued SQL proves the module contract, not a real PostgreSQL role,
// concurrency, transaction rollback or deployed-row census.
function queued() {
  const statements = [];
  up({ sql: (sql) => statements.push(sql),
    db: { query: () => assert.fail("no autocommit query in a data migration") },
    noTransaction: () => assert.fail("the runner must own the transaction") });
  return statements;
}

test("queues the own-table lock before any backfill work and stays transaction-owned", () => {
  const statements = queued();
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^LOCK TABLE ext_cinatra_ai_blog_pipeline_agent_idea_drafts,/);
  assert.match(statements[0], /ext_cinatra_ai_blog_pipeline_agent_idea_claims IN SHARE ROW EXCLUSIVE MODE$/);
  assert.ok(!/\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|SET ROLE|RESET ROLE|COMMIT|ROLLBACK)\b/i.test(statements.join("\n")));
  assert.match(statements[1], /END;\s+\$backfill\$;/, "the queued PL/pgSQL block terminates before its dollar quote");
  assert.equal(down, false, "no destructive downgrade of historical claims");
});

test("refuses preexisting targets, unknown history and duplicate active states before copying", () => {
  const sql = queued()[1];
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM ext_cinatra_ai_blog_pipeline_agent_idea_claims\)/);
  assert.match(sql, /state NOT IN \('reserved', 'drafted', 'released'\)/);
  assert.match(sql, /state = 'reserved' AND \(expires_at IS NULL OR draft_artifact_id IS NOT NULL\)/);
  assert.match(sql, /draft_artifact_id IS NULL OR btrim\(draft_artifact_id\) = ''/);
  assert.match(sql, /created_at IS NULL/);
  assert.match(sql, /WHERE state = 'drafted' OR \(state = 'reserved' AND expires_at > CURRENT_TIMESTAMP\)\s+GROUP BY org_id, idea_artifact_id/);
  assert.match(sql, /HAVING count\(\*\) FILTER \(WHERE state = 'drafted'\) > 1\s+OR count\(\*\) FILTER \(WHERE state = 'reserved'\) > 1/);
  assert.equal((sql.match(/RAISE EXCEPTION/g) ?? []).length, 3);
  assert.ok(sql.lastIndexOf("RAISE EXCEPTION") < sql.indexOf("INSERT INTO"));
  assert.ok(!/DISTINCT|ON CONFLICT|DELETE FROM|UPDATE ext_/i.test(sql), "no arbitrary winner or legacy rewrite");
});

test("copies every legacy row with bound provenance, releases expiry or the exact draft conflict and retains draft keys", () => {
  const sql = queued()[1];
  assert.match(sql, /CASE WHEN release_reservation THEN 'released' ELSE state END/);
  assert.match(sql, /legacy\.expires_at <= CURRENT_TIMESTAMP OR EXISTS/);
  assert.match(sql, /WHERE drafted\.org_id = legacy\.org_id\s+AND drafted\.idea_artifact_id = legacy\.idea_artifact_id\s+AND drafted\.state = 'drafted'/);
  assert.match(sql, /CASE WHEN state = 'drafted' OR \(state = 'reserved' AND NOT release_reservation\)\s+THEN idea_artifact_id ELSE NULL END/);
  assert.match(sql, /created_at, active_idea_key, legacy_state, legacy_expires_at/);
  assert.match(sql, /state, expires_at\s+FROM \(/);
  assert.ok(!/LIMIT|OFFSET/.test(sql.slice(sql.indexOf("INSERT INTO"))));
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const legacy = manifest.cinatra.declaredTables.find((table) => table.name === "idea_drafts");
  const claims = manifest.cinatra.declaredTables.find((table) => table.name === "idea_claims");
  assert.ok(legacy, "legacy declaration retained so the role can read its data");
  assert.equal(claims.columns.find((column) => column.name === "claim_id").default, "gen_random_uuid()");
  assert.deepEqual(claims.indexes.find((index) => index.unique).columns, ["org_id", "active_idea_key"]);
  assert.ok(manifest.files.includes("cinatra"));
});


// Execute the emitted relational SELECT/INSERT, not a JS copy of the winner
// rules. SQLite supplies the common CASE/EXISTS/GROUP BY/FILTER semantics only;
// the PostgreSQL role, LOCK/DO runner, timestamps and rollback must still be
// retested through the real host before activation. No server is started here.
const LEGACY = "ext_cinatra_ai_blog_pipeline_agent_idea_drafts";
const CLAIMS = "ext_cinatra_ai_blog_pipeline_agent_idea_claims";
const MIGRATION_NOW = "2026-09-12T10:00:00.000Z";
const legacy = (state, extra = {}) => ({
  org_id: "org-a", run_id: `run-${state}`, idea_artifact_id: "idea-one",
  idea_revision_id: `rev-${state}`, state,
  draft_artifact_id: state === "drafted" ? "draft-one" : null,
  expires_at: state === "reserved" ? "2026-09-14T10:00:00.123456Z" : null,
  created_at: "2026-09-10T09:00:00.000Z", ...extra,
});

function withRelationalMigration(rows, verify) {
  const db = new DatabaseSync(":memory:");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  db.function("btrim", (value) => value === null ? null : value.trim());
  db.function("gen_random_uuid", () => randomUUID());
  try {
    for (const name of ["idea_drafts", "idea_claims"]) {
      const table = manifest.cinatra.declaredTables.find((item) => item.name === name);
      const columns = table.columns.map((column) => `${column.name} TEXT${column.name === "claim_id" ? " PRIMARY KEY DEFAULT (gen_random_uuid())" : ""}`);
      db.exec(`CREATE TABLE ${name === "idea_drafts" ? LEGACY : CLAIMS} (${columns.join(", ")})`);
    }
    const unique = manifest.cinatra.declaredTables.find((item) => item.name === "idea_claims")
      .indexes.find((index) => index.unique);
    db.exec(`CREATE UNIQUE INDEX claims_active ON ${CLAIMS} (${unique.columns.join(", ")})`);
    for (const row of rows) {
      const keys = Object.keys(row);
      db.prepare(`INSERT INTO ${LEGACY} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((key) => row[key]));
    }
    const before = db.prepare(`SELECT * FROM ${LEGACY} ORDER BY rowid`).all();
    const emitted = queued()[1].replaceAll("CURRENT_TIMESTAMP", `'${MIGRATION_NOW}'`);
    const guards = [...emitted.matchAll(/IF EXISTS\s*\(([\s\S]*?)\) THEN\s*RAISE EXCEPTION '([^']+)'/g)];
    assert.equal(guards.length, 3, "all emitted guards are executed");
    const copy = emitted.match(/INSERT INTO[\s\S]+?;\s*END;/)?.[0].replace(/;\s*END;$/, ";");
    assert.ok(copy, "the actual emitted INSERT SELECT is extracted whole");
    let failure = null;
    db.exec("BEGIN");
    try {
      for (const [, query, message] of guards) {
        if (db.prepare(query).all().length) throw new Error(message);
      }
      db.exec(copy);
      db.exec("COMMIT");
    } catch (error) {
      failure = error;
      db.exec("ROLLBACK");
    }
    assert.deepEqual(db.prepare(`SELECT * FROM ${LEGACY} ORDER BY rowid`).all(), before,
      "the migration never rewrites legacy rows");
    verify({ claims: db.prepare(`SELECT * FROM ${CLAIMS} ORDER BY rowid`).all(), failure });
  } finally {
    db.close();
  }
}

test("live drafted wins over exactly one stale reserved claim without losing legacy provenance", () => {
  const stale = legacy("reserved");
  withRelationalMigration([legacy("drafted"), stale], ({ claims, failure }) => {
    assert.equal(failure, null, "this known legacy conflict must migrate without operator SQL or a TTL wait");
    assert.equal(claims.length, 2);
    const held = claims.find((row) => row.legacy_state === "drafted");
    const released = claims.find((row) => row.legacy_state === "reserved");
    assert.equal(held.state, "drafted");
    assert.equal(held.active_idea_key, "idea-one");
    assert.equal(released.state, "released");
    assert.equal(released.active_idea_key, null);
    assert.equal(released.expires_at, null);
    assert.equal(released.legacy_state, "reserved");
    assert.equal(released.legacy_expires_at, stale.expires_at);
    for (const key of ["org_id", "run_id", "idea_artifact_id", "idea_revision_id", "created_at"]) {
      assert.equal(released[key], stale[key]);
    }
    assert.equal(new Set(claims.map((row) => row.claim_id)).size, 2);
  });
});

for (const states of [["drafted", "drafted"], ["reserved", "reserved"],
  ["drafted", "reserved", "reserved"], ["drafted", "drafted", "reserved"]]) {
  test(`other active conflicts still fail closed: ${states.join("+")}`, () => {
    withRelationalMigration(states.map((state, index) => legacy(state, { run_id: `run-${index}` })),
      ({ claims, failure }) => {
        assert.match(failure?.message ?? "", /Conflicting active legacy/);
        assert.equal(claims.length, 0);
      });
  });
}

test("draft precedence is isolated to the exact organisation and idea", () => {
  withRelationalMigration([legacy("drafted"), legacy("reserved"),
    legacy("reserved", { org_id: "org-b", run_id: "other-org" }),
    legacy("reserved", { idea_artifact_id: "other-idea", run_id: "other-idea" })],
  ({ claims, failure }) => {
    assert.equal(failure, null);
    assert.equal(claims.length, 4);
    assert.equal(claims.find((row) => row.run_id === "run-reserved").state, "released");
    for (const run of ["other-org", "other-idea"]) {
      const row = claims.find((claim) => claim.run_id === run);
      assert.equal(row.state, "reserved");
      assert.equal(row.active_idea_key, row.idea_artifact_id);
      assert.equal(row.expires_at, row.legacy_expires_at);
    }
  });
});

test("malformed history remains an activation refusal beside a valid draft conflict", () => {
  withRelationalMigration([legacy("drafted"), legacy("reserved"), legacy("unknown", { idea_artifact_id: "malformed" })],
    ({ claims, failure }) => {
      assert.match(failure?.message ?? "", /Unknown or incomplete legacy/);
      assert.equal(claims.length, 0);
    });
});
