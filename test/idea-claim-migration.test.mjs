import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
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

test("refuses preexisting targets, unknown history and all conflicting active rows before copying", () => {
  const sql = queued()[1];
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM ext_cinatra_ai_blog_pipeline_agent_idea_claims\)/);
  assert.match(sql, /state NOT IN \('reserved', 'drafted', 'released'\)/);
  assert.match(sql, /state = 'reserved' AND \(expires_at IS NULL OR draft_artifact_id IS NOT NULL\)/);
  assert.match(sql, /draft_artifact_id IS NULL OR btrim\(draft_artifact_id\) = ''/);
  assert.match(sql, /created_at IS NULL/);
  assert.match(sql, /WHERE state = 'drafted' OR \(state = 'reserved' AND expires_at > CURRENT_TIMESTAMP\)\s+GROUP BY org_id, idea_artifact_id HAVING count\(\*\) > 1/);
  assert.equal((sql.match(/RAISE EXCEPTION/g) ?? []).length, 3);
  assert.ok(sql.lastIndexOf("RAISE EXCEPTION") < sql.indexOf("INSERT INTO"));
  assert.ok(!/DISTINCT|ON CONFLICT|DELETE FROM|UPDATE ext_/i.test(sql), "no arbitrary winner or legacy rewrite");
});

test("copies every legacy row with bound provenance, classifies only definite expiry and retains draft keys", () => {
  const sql = queued()[1];
  assert.match(sql, /CASE WHEN state = 'reserved' AND expires_at <= CURRENT_TIMESTAMP THEN 'released' ELSE state END/);
  assert.match(sql, /CASE WHEN state = 'drafted' OR \(state = 'reserved' AND expires_at > CURRENT_TIMESTAMP\)\s+THEN idea_artifact_id ELSE NULL END/);
  assert.match(sql, /created_at, active_idea_key, legacy_state, legacy_expires_at/);
  assert.match(sql, /state, expires_at\s+FROM ext_cinatra_ai_blog_pipeline_agent_idea_drafts;/);
  assert.ok(!/LIMIT|OFFSET|WHERE[^;]*FROM ext_cinatra_ai_blog_pipeline_agent_idea_drafts;/s.test(sql.slice(sql.indexOf("INSERT INTO"))));
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const legacy = manifest.cinatra.declaredTables.find((table) => table.name === "idea_drafts");
  const claims = manifest.cinatra.declaredTables.find((table) => table.name === "idea_claims");
  assert.ok(legacy, "legacy declaration retained so the role can read its data");
  assert.equal(claims.columns.find((column) => column.name === "claim_id").default, "gen_random_uuid()");
  assert.deepEqual(claims.indexes.find((index) => index.unique).columns, ["org_id", "active_idea_key"]);
  assert.ok(manifest.files.includes("cinatra"));
});
