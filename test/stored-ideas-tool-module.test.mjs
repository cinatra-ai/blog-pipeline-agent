/**
 * THE DECLARED MODULE, through its ports.
 *
 * The gate no longer travels through a tool of the host's own: the host loads
 * THIS pack's module from its own tree at the pinned lock and calls the one
 * export the contract names with the ports — the table operations on this pack's
 * own declared table, the dependency-scoped artifact reads, the review-gate
 * filing and the clock. So the module is the pack's, and everything the three
 * flow steps do is provable here without a database.
 *
 * THE FAKE PORTS REFUSE WHAT THE HOST REFUSES. The organisation and the run are
 * the host's to write: a request naming one of those columns is refused here
 * exactly as the data contract refuses it, and a module asks for this run's own
 * rows with the marker `{ boundRun: true }` instead. The reservation table binds
 * no scope, so a scope marker is refused as the host refuses it on a table that
 * declares no scope column. So "no run id appears anywhere in the pack's code or
 * tool input" is a test and not a reading of the diff.
 *
 * A RUN LAUNCHED WITH NO SCOPE (from the agents page, a schedule or another
 * agent) carries no launch scope, and the host refuses `no-scope` rather than
 * stamp one. Its own suite below runs every operation for such a run.
 *
 *   node --test test/stored-ideas-tool-module.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { extensionTool } from "../cinatra/tools/stored-ideas.mjs";
import {
  IDEA_TAKEN_REASON,
  offerStoredIdeas,
  resolveIdeaPick,
  titleFromIdeaText,
} from "../src/lib/blog/stored-ideas-gate.ts";

const TABLE = "idea_claims";
const IDEA_TYPE = "@cinatra-ai/blog-idea-artifact:blog-idea";
const ORG_COLUMN = "org_id";
const RUN_COLUMN = "run_id";
/** What the HOST would bind. Nothing below hands it to the module. */
const BOUND_RUN = "run-under-test";

const IDEA_A = {
  artifactId: "idea-a",
  latestRepresentationRevisionId: "rev-a",
  text: "Title: Shipping on Fridays\n\nWhy a Friday deploy is a habit, not a risk.",
};
const IDEA_B = {
  artifactId: "idea-b",
  latestRepresentationRevisionId: "rev-b",
  text: "Reading a run's own page\n\nWhat a run should show when it is done.",
};

function isMarker(value, key) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    value[key] === true
  );
}

/** The host's own refusals over one data request, applied to every call the
 *  module makes: the bound columns are never named, the run marker stands only on
 *  the run column, and no scope marker stands anywhere — the table binds none. */
function assertBoundColumnsAreTheHosts(request) {
  for (const field of ["row", "set", "expect", "values"]) {
    for (const key of Object.keys(request[field] ?? {})) {
      assert.ok(
        key !== ORG_COLUMN && key !== RUN_COLUMN,
        `the module writes no bound column — "${key}" (${field}) is the host's`,
      );
    }
  }
  for (const key of request.conflictKeys ?? []) {
    assert.ok(
      key !== ORG_COLUMN && key !== RUN_COLUMN,
      `a conflict key names no bound column — "${key}" is the host's`,
    );
  }
  for (const [key, value] of Object.entries(request.where ?? {})) {
    assert.notEqual(key, ORG_COLUMN, "the organisation column is injected by the host");
    if (key === RUN_COLUMN) {
      assert.ok(
        isMarker(value, "boundRun"),
        "the run column takes the bound-run marker and no literal",
      );
      continue;
    }
    assert.ok(!isMarker(value, "boundRun"), `"${key}" is not the run column`);
    assert.ok(
      !isMarker(value, "boundScope"),
      `"${key}" takes no bound-scope marker — the reservation table declares no scope column`,
    );
  }
  const printed = JSON.stringify(request);
  assert.ok(!printed.includes(BOUND_RUN), "no run id reaches a request");
}

/**
 * The ports, as the host binds them: the table operations over an in-memory
 * store whose rows the host stamps with the organisation and the run, the
 * artifact reads over the two ideas, the review filing and a fixed clock.
 */
function ports(options = {}) {
  let nextClaim = 100;
  const rows = (options.rows ?? []).map((row) => ({
    [ORG_COLUMN]: "org-under-test",
    [RUN_COLUMN]: row[RUN_COLUMN] ?? BOUND_RUN,
    ...row,
  }));
  const calls = [];
  const filed = [];
  const now = options.now ?? new Date("2026-09-12T10:00:00.000Z");

  const matches = (row, request) => {
    for (const [key, value] of Object.entries(request.where ?? {})) {
      if (key === RUN_COLUMN) {
        if (row[RUN_COLUMN] !== BOUND_RUN) return false;
        continue;
      }
      if (row[key] !== value) return false;
    }
    for (const [key, value] of Object.entries(request.expect ?? {})) {
      if (row[key] !== value) return false;
    }
    return true;
  };

  return {
    calls,
    filed,
    rows,
    data: {
      async select(request) {
        calls.push({ operation: "select", ...request });
        assert.equal(request.table, TABLE);
        assertBoundColumnsAreTheHosts(request);
        // The host filters first, then applies its bounded read window. Do not
        // let append-only released history pass tests by ignoring LIMIT.
        const limit = Math.min(1000, request.limit ?? 100);
        const selected = rows.filter((row) => matches(row, request)).slice(0, limit);
        return { rows: selected, rowCount: selected.length, table: TABLE };
      },
      async insertIfAbsent(request) {
        calls.push({ operation: "insertIfAbsent", ...request });
        assert.equal(request.table, TABLE);
        assertBoundColumnsAreTheHosts(request);
        assert.ok(
          (request.conflictKeys ?? []).length > 0,
          "insertIfAbsent names the columns identifying the row it would collide with",
        );
        // Model the manifest's ordinary UNIQUE columns, including SQL NULL
        // semantics. This deliberately does not invent a cross-state constraint.
        const declaration = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
          .cinatra.declaredTables.find((table) => table.name === TABLE);
        const live = rows.find((row) => declaration.indexes.some((index) => index.unique &&
          index.columns.every((key) => {
            const value = key === ORG_COLUMN ? "org-under-test" : request.row[key];
            return value != null && row[key] === value;
          })));
        if (live) {
          // Another run's winning row is never "the row that won" for this one.
          return {
            inserted: false,
            conflict: true,
            existing: live[RUN_COLUMN] === BOUND_RUN ? { ...live } : null,
          };
        }
        const written = {
          [ORG_COLUMN]: "org-under-test",
          [RUN_COLUMN]: BOUND_RUN,
          claim_id: `00000000-0000-0000-0000-${String(++nextClaim).padStart(12, "0")}`,
          ...request.row,
        };
        rows.push(written);
        return { inserted: true, row: { ...written } };
      },
      async updateWhere(request) {
        calls.push({ operation: "updateWhere", ...request });
        assert.equal(request.table, TABLE);
        assertBoundColumnsAreTheHosts(request);
        options.beforeUpdate?.(request, rows);
        let updated = 0;
        for (const row of rows) {
          if (!matches(row, request)) continue;
          Object.assign(row, request.set);
          updated += 1;
        }
        return { updated };
      },
    },
    artifacts: {
      async list(request) {
        calls.push({ operation: "artifacts_list", ...request });
        assert.deepEqual(request.types, [IDEA_TYPE], "the caller names its own declared type");
        const artifacts = (options.artifacts ?? [IDEA_A, IDEA_B]).map((idea) => ({
          artifactId: idea.artifactId,
          latestRepresentationRevisionId: idea.latestRepresentationRevisionId,
        }));
        return { artifacts, nextCursor: null };
      },
      async contentRead(request) {
        calls.push({ operation: "artifact_content_read", ...request });
        const idea = [IDEA_A, IDEA_B].find((i) => i.artifactId === request.artifactId);
        if (!idea) throw new Error(`no such artifact: ${request.artifactId}`);
        return {
          artifactId: idea.artifactId,
          representationRevisionId: idea.latestRepresentationRevisionId,
          mime: "text/plain",
          text: idea.text,
          truncated: false,
          bytesRead: idea.text.length,
          totalBytes: idea.text.length,
        };
      },
    },
    review: {
      file(targets) {
        filed.push(targets);
      },
    },
    clock: {
      now() {
        return now;
      },
    },
  };
}

const reserved = (ideaArtifactId, extra = {}) => ({
  claim_id: ideaArtifactId === IDEA_B.artifactId ? "00000000-0000-0000-0000-000000000002" : "00000000-0000-0000-0000-000000000001",
  active_idea_key: ideaArtifactId,
  idea_artifact_id: ideaArtifactId,
  idea_revision_id: `${ideaArtifactId}-rev`,
  state: "reserved",
  draft_artifact_id: null,
  expires_at: "2026-09-14T10:00:00.000Z",
  created_at: "2026-09-12T09:00:00.000Z",
  ...extra,
});

describe("the module the manifest declares", () => {
  it("is one callable export of one argument", async () => {
    assert.equal(typeof extensionTool, "function");
    assert.equal(extensionTool.length, 1);
  });

  it("refuses an operation it does not carry, and a call naming none", async () => {
    const p = ports();
    await assert.rejects(() => extensionTool({ input: { op: "delete", ideaType: IDEA_TYPE }, ports: p }));
    await assert.rejects(() => extensionTool({ input: { ideaType: IDEA_TYPE }, ports: p }));
    assert.deepEqual(p.calls, [], "a refused call reads and writes nothing");
  });

  it("refuses a call that names no artifact type, on every operation", async () => {
    for (const op of ["prepare", "reserve", "complete"]) {
      const p = ports();
      await assert.rejects(
        () => extensionTool({ input: { op }, ports: p }),
        (error) => {
          assert.equal(error.name, "IdeaTypeRefusal");
          assert.equal(error.reason, "invalid-request");
          return true;
        },
      );
      assert.deepEqual(p.calls, []);
    }
  });
});

describe("op prepare", () => {
  it("offers the organisation's unused ideas, each under the title its first line is", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId)] });
    const result = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.equal(result.ok, true);
    assert.equal(result.reason, "");
    assert.deepEqual(
      result.ideas.map((idea) => idea.artifactId),
      [IDEA_B.artifactId],
      "the reserved idea is off the list",
    );
    assert.equal(result.ideas[0].title, titleFromIdeaText(IDEA_B.text));
    assert.equal(result.ideas[0].representationRevisionId, IDEA_B.latestRepresentationRevisionId);
    // ONE CONTENT READ PER UNUSED IDEA, and none for an idea already taken.
    const reads = p.calls.filter((c) => c.operation === "artifact_content_read");
    assert.deepEqual(reads.map((r) => r.artifactId), [IDEA_B.artifactId]);
  });

  it("reads the organisation's rows, with no scope marker and no run of its own", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId, { [RUN_COLUMN]: "another-run" })] });
    await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    const select = p.calls.find((c) => c.operation === "select");
    assert.ok(select, "prepare reads the reservation rows");
    assert.deepEqual(
      select.where,
      { active_idea_key: IDEA_A.artifactId },
      "the host scopes the organisation and the module targets only the candidate's active key",
    );
    assert.ok(
      !(RUN_COLUMN in select.where),
      "a sibling run's reservation is exactly what this run must see, so the run is not named",
    );
  });

  it("ends the run with a stated reason when nothing is left to draft", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId), reserved(IDEA_B.artifactId)] });
    const result = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.equal(result.ok, false);
    assert.deepEqual(result.ideas, []);
    assert.equal(
      result.reason,
      offerStoredIdeas({ candidates: [], takenArtifactIds: [] }).reason,
      "the sentence the gate's own decision module ends the run with",
    );
  });

  it("releases a lapsed reservation before it selects the offer, and offers the idea again", async () => {
    const p = ports({
      rows: [
        reserved(IDEA_A.artifactId, {
          [RUN_COLUMN]: "abandoned-run",
          expires_at: "2026-09-12T09:59:59.000Z",
        }),
      ],
    });
    const result = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.ideas.map((idea) => idea.artifactId),
      [IDEA_A.artifactId, IDEA_B.artifactId],
      "the lapsed reservation handed its idea back to the list this run offers",
    );
    const order = p.calls.map((c) => c.operation);
    assert.ok(
      order.indexOf("updateWhere") < order.indexOf("artifact_content_read"),
      "the sweep runs AHEAD of the reads, so the offer is the list it just widened",
    );
    const release = p.calls.find((c) => c.operation === "updateWhere");
    assert.deepEqual(release.set, { state: "released", active_idea_key: null, expires_at: null });
    assert.equal(release.where.idea_artifact_id, IDEA_A.artifactId);
    assert.equal(release.expect.state, "reserved");
    assert.equal(release.where.claim_id, p.rows[0].claim_id);
    assert.equal(release.where.expires_at, "2026-09-12T09:59:59.000Z");
    assert.ok(
      !(RUN_COLUMN in release.where),
      "the sweep releases reservations of runs that are not this one",
    );
    assert.equal(p.rows[0].state, "released");
  });

  it("leaves a drafted relation and an unexpired reservation standing", async () => {
    const p = ports({
      rows: [
        reserved(IDEA_A.artifactId, { state: "drafted", expires_at: null }),
        reserved(IDEA_B.artifactId, { expires_at: "2026-09-13T10:00:00.000Z" }),
      ],
    });
    const result = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.equal(result.ok, false, "both ideas are still taken");
    assert.deepEqual(p.calls.filter((c) => c.operation === "updateWhere"), []);
  });
});

describe("op reserve", () => {
  const offered = [
    {
      artifactId: IDEA_B.artifactId,
      representationRevisionId: IDEA_B.latestRepresentationRevisionId,
      title: titleFromIdeaText(IDEA_B.text),
      text: IDEA_B.text,
    },
  ];
  const pick = JSON.stringify({
    artifactId: IDEA_B.artifactId,
    representationRevisionId: IDEA_B.latestRepresentationRevisionId,
  });

  it("takes the picked idea for this run and writes no run, scope or organisation", async () => {
    const p = ports();
    const result = await extensionTool({
      input: { op: "reserve", ideaType: IDEA_TYPE, pick, offered: JSON.stringify(offered) },
      ports: p,
    });
    assert.deepEqual(result, {
      idea: IDEA_B.text,
      claimId: p.rows[0].claim_id,
      ideaArtifactId: IDEA_B.artifactId,
      ideaRevisionId: IDEA_B.latestRepresentationRevisionId,
      ideaTitle: titleFromIdeaText(IDEA_B.text),
      reason: "",
    });
    const write = p.calls.find((c) => c.operation === "insertIfAbsent");
    assert.deepEqual(Object.keys(write.row).sort(), [
      "active_idea_key",
      "created_at",
      "draft_artifact_id",
      "expires_at",
      "idea_artifact_id",
      "idea_revision_id",
      "state",
    ]);
    assert.equal(write.row.state, "reserved");
    assert.ok(
      Date.parse(write.row.expires_at) > Date.parse(write.row.created_at),
      "a reservation is held for a while and then lapses",
    );
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0][RUN_COLUMN], BOUND_RUN, "the host stamped the run, not the module");
  });

  it("tells the loser of the race their idea was just taken", async () => {
    const p = ports({ rows: [reserved(IDEA_B.artifactId, { [RUN_COLUMN]: "winning-run" })] });
    const result = await extensionTool({
      input: { op: "reserve", ideaType: IDEA_TYPE, pick, offered: JSON.stringify(offered) },
      ports: p,
    });
    assert.deepEqual(result, { reason: IDEA_TAKEN_REASON });
    assert.equal(p.rows.length, 1, "nothing was written for the loser");
  });

  it("refuses a pick the offered list does not hold, and writes nothing", async () => {
    const p = ports();
    const result = await extensionTool({
      input: {
        op: "reserve",
        ideaType: IDEA_TYPE,
        pick: JSON.stringify({ artifactId: "idea-z", representationRevisionId: "rev-z" }),
        offered: JSON.stringify(offered),
      },
      ports: p,
    });
    assert.equal(
      result.reason,
      resolveIdeaPick({
        pick: JSON.stringify({ artifactId: "idea-z", representationRevisionId: "rev-z" }),
        offered,
      }).reason,
      "the sentence the gate's own decision module refuses the pick with",
    );
    assert.deepEqual(p.calls, []);
  });

  it("refuses a pick made against a list it cannot read", async () => {
    const p = ports();
    const result = await extensionTool({
      input: { op: "reserve", ideaType: IDEA_TYPE, pick, offered: "not json at all" },
      ports: p,
    });
    assert.equal(result.reason, resolveIdeaPick({ pick, offered: [] }).reason);
    assert.deepEqual(p.calls, []);
  });

  it("refuses a call with nothing picked", async () => {
    const p = ports();
    const result = await extensionTool({
      input: { op: "reserve", ideaType: IDEA_TYPE, pick: "", offered: JSON.stringify(offered) },
      ports: p,
    });
    assert.equal(result.reason, resolveIdeaPick({ pick: "", offered }).reason);
    assert.deepEqual(p.calls, []);
  });
});

describe("op complete", () => {
  it("completes THIS RUN's reservation into the relation and files the review's targets", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId)] });
    const targets = [{ artifactId: "draft-1", representationRevisionId: "draft-rev-1" }];
    const result = await extensionTool({
      input: {
        op: "complete",
        ideaType: IDEA_TYPE,
        ideaArtifactId: IDEA_A.artifactId,
        claimId: "00000000-0000-0000-0000-000000000001",
        draftArtifactId: "draft-1",
        reviewTargets: JSON.stringify(targets),
      },
      ports: p,
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(p.filed, [targets], "the filing is the host's to validate and ride out");
    const write = p.calls.find((c) => c.operation === "updateWhere");
    assert.deepEqual(write.set, {
      state: "drafted",
      draft_artifact_id: "draft-1",
      expires_at: null,
    });
    assert.deepEqual(write.where[RUN_COLUMN], { boundRun: true }, "keyed by THIS run");
    assert.equal(write.where.idea_artifact_id, IDEA_A.artifactId);
    assert.equal(p.rows[0].state, "drafted");
    assert.equal(p.rows[0].draft_artifact_id, "draft-1");
  });

  it("completes the SAME row on a retry, never a second", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId)] });
    const call = {
      op: "complete",
      ideaType: IDEA_TYPE,
      ideaArtifactId: IDEA_A.artifactId,
      claimId: "00000000-0000-0000-0000-000000000001",
      draftArtifactId: "draft-1",
      reviewTargets: JSON.stringify([
        { artifactId: "draft-1", representationRevisionId: "draft-rev-1" },
      ]),
    };
    await extensionTool({ input: call, ports: p });
    await extensionTool({ input: call, ports: p });
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0].state, "drafted");
  });

  it("says so when the completion did not land, rather than hiding behind the echo", async () => {
    const p = ports();
    const result = await extensionTool({
      input: {
        op: "complete",
        ideaType: IDEA_TYPE,
        ideaArtifactId: IDEA_A.artifactId,
        claimId: "00000000-0000-0000-0000-000000000001",
        draftArtifactId: "draft-1",
        reviewTargets: "[]",
      },
      ports: p,
    });
    assert.deepEqual(result, { ok: false });
  });

  it("hands a filing it cannot read to the host, which states the refusal", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId)] });
    await extensionTool({
      input: {
        op: "complete",
        ideaType: IDEA_TYPE,
        ideaArtifactId: IDEA_A.artifactId,
        claimId: "00000000-0000-0000-0000-000000000001",
        draftArtifactId: "draft-1",
        reviewTargets: "{not json",
      },
      ports: p,
    });
    assert.deepEqual(p.filed, ["{not json"], "nothing is silently dropped on the way to a review");
  });
});

/**
 * THE HOST'S REFUSAL FOR A RUN LAUNCHED WITH NO SCOPE. Such a run carries no
 * launch scope, so the host refuses `no-scope` on any request that asks for the
 * bound scope, and on EVERY statement against a table that declares a scope pair
 * (the scope floor stands on each of them) — rather than stamp a scope the run
 * never recorded. This port is the ordinary fake with exactly that refusal in
 * front of it, and it reads the declaration from this pack's own manifest.
 */
const DECLARED_TABLE = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).cinatra.declaredTables.find((t) => t && t.name === TABLE);

class ExtensionDataRefusal extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "ExtensionDataRefusal";
    this.reason = reason;
  }
}

function asksForTheBoundScope(request) {
  return ["where", "row", "set", "expect", "values"].some((field) =>
    Object.values(request[field] ?? {}).some((value) => isMarker(value, "boundScope")),
  );
}

function unanchoredPorts(options = {}) {
  const p = ports(options);
  const bindsScope = Boolean(
    DECLARED_TABLE && (DECLARED_TABLE.scopeKindColumn || DECLARED_TABLE.scopeIdColumn),
  );
  for (const operation of ["select", "insertIfAbsent", "updateWhere"]) {
    const inner = p.data[operation];
    p.data[operation] = async (request) => {
      if (bindsScope || asksForTheBoundScope(request)) {
        p.calls.push({ operation: "refused", reason: "no-scope", of: operation });
        throw new ExtensionDataRefusal(
          "no-scope",
          `extension_data: "${request.table}" binds its rows to the scope their run belongs to and ` +
            "this call carries none — refusing rather than reaching across scopes",
        );
      }
      return inner(request);
    };
  }
  return p;
}

describe("a run launched with no scope", () => {
  it("is offered the organisation's unused ideas, after the lapsed reservations are released", async () => {
    const p = unanchoredPorts({
      rows: [
        reserved(IDEA_A.artifactId, {
          [RUN_COLUMN]: "abandoned-run",
          expires_at: "2026-09-12T09:59:59.000Z",
        }),
      ],
    });
    const result = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.equal(result.ok, true);
    assert.equal(result.reason, "");
    assert.deepEqual(
      result.ideas.map((idea) => idea.artifactId),
      [IDEA_A.artifactId, IDEA_B.artifactId],
    );
    assert.deepEqual(p.calls.filter((c) => c.operation === "refused"), [], "no request was refused");
    assert.equal(p.rows[0].state, "released", "the sweep released the lapsed reservation");
  });

  it("ends with the stated reason, never a refusal, when the organisation holds no idea", async () => {
    const p = unanchoredPorts({ artifacts: [] });
    const result = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.deepEqual(result, {
      ok: false,
      ideas: [],
      reason: offerStoredIdeas({ candidates: [], takenArtifactIds: [] }).reason,
    });
  });

  it("takes the picked idea, and the host stamps the organisation and the run", async () => {
    const offered = [
      {
        artifactId: IDEA_B.artifactId,
        representationRevisionId: IDEA_B.latestRepresentationRevisionId,
        title: titleFromIdeaText(IDEA_B.text),
        text: IDEA_B.text,
      },
    ];
    const pick = JSON.stringify({
      artifactId: IDEA_B.artifactId,
      representationRevisionId: IDEA_B.latestRepresentationRevisionId,
    });
    const p = unanchoredPorts();
    const result = await extensionTool({
      input: { op: "reserve", ideaType: IDEA_TYPE, pick, offered: JSON.stringify(offered) },
      ports: p,
    });
    assert.equal(result.reason, "");
    assert.equal(result.ideaArtifactId, IDEA_B.artifactId);
    const write = p.calls.find((c) => c.operation === "insertIfAbsent");
    assert.ok(write, "the reservation was written");
    assert.deepEqual(write.conflictKeys, ["active_idea_key"]);
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0][RUN_COLUMN], BOUND_RUN, "the host stamped the run, not the module");
  });

  it("completes its reservation into the relation, keyed by claim and bound run", async () => {
    const p = unanchoredPorts({ rows: [reserved(IDEA_A.artifactId)] });
    const result = await extensionTool({
      input: {
        op: "complete",
        ideaType: IDEA_TYPE,
        ideaArtifactId: IDEA_A.artifactId,
        claimId: "00000000-0000-0000-0000-000000000001",
        draftArtifactId: "draft-1",
        reviewTargets: "[]",
      },
      ports: p,
    });
    assert.deepEqual(result, { ok: true });
    const write = p.calls.find((c) => c.operation === "updateWhere");
    assert.deepEqual(write.where, { claim_id: p.rows[0].claim_id, idea_artifact_id: IDEA_A.artifactId, [RUN_COLUMN]: { boundRun: true } });
    assert.equal(p.rows[0].state, "drafted");
  });
});

// A stale offered list stays parked while another run completes its draft.
// The OLD unique(org, idea, state) admits another reserved row beside drafted.
describe("immutable idea claims", () => {
  it("refuses a stale offered reserve after the idea is drafted", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId, {
      state: "drafted", draft_artifact_id: "draft-first", expires_at: null,
    })] });
    const offered = [{ artifactId: IDEA_A.artifactId,
      representationRevisionId: IDEA_A.latestRepresentationRevisionId, text: IDEA_A.text }];
    const result = await extensionTool({ input: { op: "reserve", ideaType: IDEA_TYPE,
      pick: JSON.stringify(offered[0]), offered }, ports: p });
    assert.deepEqual(result, { reason: IDEA_TAKEN_REASON });
    assert.equal(p.rows.length, 1, "no second claim alongside the drafted history");
  });
});


describe("claim completion and expiration boundaries", () => {
  const call = { op: "complete", ideaType: IDEA_TYPE, ideaArtifactId: IDEA_A.artifactId,
    claimId: "00000000-0000-0000-0000-000000000001", draftArtifactId: "draft-one",
    reviewTargets: '[{"artifactId":"draft-one","representationRevisionId":"draft-rev"}]' };
  it("refuses missing or malformed claim identities before any port use", async () => {
    for (const claimId of [undefined, "", "not-a-uuid"]) {
      const p = ports({ rows: [reserved(IDEA_A.artifactId)] });
      assert.deepEqual(await extensionTool({ input: { ...call, claimId }, ports: p }), { ok: false });
      assert.deepEqual(p.calls, []);
    }
  });
  it("cannot complete a sibling run's claim", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId, { run_id: "other-run" })] });
    assert.deepEqual(await extensionTool({ input: call, ports: p }), { ok: false });
    assert.equal(p.rows[0].state, "reserved");
    assert.deepEqual(p.filed, []);
  });
  it("never completes a released or expired claim", async () => {
    for (const extra of [{ state: "released", active_idea_key: null },
      { expires_at: "2026-09-12T09:59:00.000Z" }]) {
      const p = ports({ rows: [reserved(IDEA_A.artifactId, extra)] });
      assert.deepEqual(await extensionTool({ input: call, ports: p }), { ok: false });
      assert.deepEqual(p.filed, []);
    }
  });
  it("retains the original draft and active key on a different-draft retry", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId)] });
    assert.deepEqual(await extensionTool({ input: call, ports: p }), { ok: true });
    assert.deepEqual(await extensionTool({ input: call, ports: p }), { ok: true });
    assert.deepEqual(await extensionTool({ input: { ...call, draftArtifactId: "draft-other" }, ports: p }), { ok: false });
    assert.equal(p.rows[0].draft_artifact_id, "draft-one");
    assert.equal(p.rows[0].active_idea_key, IDEA_A.artifactId);
  });
  it("creates a new claim after expiry and refuses completion by the old same-run claim", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId, { expires_at: "2026-09-12T09:59:00.000Z" })] });
    await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    const offered = [{ artifactId: IDEA_A.artifactId, representationRevisionId: IDEA_A.latestRepresentationRevisionId }];
    const next = await extensionTool({ input: { op: "reserve", ideaType: IDEA_TYPE, offered, pick: offered[0] }, ports: p });
    assert.notEqual(next.claimId, call.claimId);
    assert.equal(p.rows.length, 2, "released history is retained beside the new claim");
    assert.equal(p.rows[0].active_idea_key, null);
    assert.deepEqual(await extensionTool({ input: call, ports: p }), { ok: false });
    assert.equal(p.rows[1].state, "reserved");
    assert.deepEqual(await extensionTool({ input: { ...call, claimId: next.claimId }, ports: p }), { ok: true });
  });
  it("cannot release a lease renewed between the sweep read and update", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId, { expires_at: "2026-09-12T09:59:00.000Z" })],
      beforeUpdate: (_request, rows) => { rows[0].expires_at = "2026-09-14T10:00:00.000Z"; } });
    const result = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.ok(!result.ideas.some((idea) => idea.artifactId === IDEA_A.artifactId));
    assert.equal(p.rows[0].state, "reserved");
    assert.equal(p.rows[0].active_idea_key, IDEA_A.artifactId);
  });
  it("a stale expiry sweep cannot release a successor claim", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId, { expires_at: "2026-09-12T09:59:00.000Z" })],
      beforeUpdate: (_request, rows) => { rows[0].claim_id = "00000000-0000-0000-0000-000000000099"; } });
    await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    assert.equal(p.rows[0].state, "reserved");
  });
  it("a renewed claim between completion read and update refuses the stale CAS", async () => {
    const p = ports({ rows: [reserved(IDEA_A.artifactId)],
      beforeUpdate: (_request, rows) => { rows[0].expires_at = "2026-09-15T10:00:00.000Z"; } });
    assert.deepEqual(await extensionTool({ input: call, ports: p }), { ok: false });
    assert.equal(p.rows[0].state, "reserved");
    assert.deepEqual(p.filed, []);
  });
  it("a conflict without a visible winner remains a refusal", async () => {
    const p = ports();
    p.data.insertIfAbsent = async () => ({ inserted: false, conflict: true, existing: null });
    const offered = [{ artifactId: IDEA_A.artifactId, representationRevisionId: IDEA_A.latestRepresentationRevisionId }];
    assert.deepEqual(await extensionTool({ input: { op: "reserve", ideaType: IDEA_TYPE, offered, pick: offered[0] }, ports: p }),
      { reason: IDEA_TAKEN_REASON });
  });
});


describe("claim history beyond the host read limit", () => {
  const history = () => Array.from({ length: 1001 }, (_, index) =>
    reserved(IDEA_A.artifactId, {
      claim_id: `10000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      state: "released", active_idea_key: null, expires_at: null,
    }));
  it("reclaims an expired claim after more than 1000 released leases", async () => {
    const expired = reserved(IDEA_A.artifactId, {
      claim_id: "20000000-0000-0000-0000-000000000001",
      expires_at: "2026-09-12T09:59:00.000Z",
    });
    const p = ports({ rows: [...history(), expired] });
    const offer = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
    const reclaimed = p.rows.at(-1);
    assert.equal(reclaimed.state, "released", "the later expired active claim is actually swept");
    assert.equal(reclaimed.active_idea_key, null);
    assert.ok(offer.ideas.some((idea) => idea.artifactId === IDEA_A.artifactId));
    assert.equal(p.rows.length, 1002, "every history row is retained");
    const picked = { artifactId: IDEA_A.artifactId, representationRevisionId: IDEA_A.latestRepresentationRevisionId };
    const next = await extensionTool({ input: { op: "reserve", ideaType: IDEA_TYPE, offered: [picked], pick: picked }, ports: p });
    assert.ok(next.claimId, "the reclaimed idea can actually be reserved");
    assert.notEqual(next.claimId, expired.claim_id);
    assert.equal(p.rows.length, 1003);
    const queries = p.calls.filter((call) => call.operation === "select");
    assert.deepEqual(queries.map((call) => call.where),
      [{ active_idea_key: IDEA_A.artifactId }, { active_idea_key: IDEA_B.artifactId }]);
    assert.ok(queries.every((call) => call.limit === 1));
  });
  for (const state of ["drafted", "reserved"]) {
    it(`excludes a later ${state} claim despite more than 1000 released leases`, async () => {
      const held = reserved(IDEA_A.artifactId, {
        claim_id: "20000000-0000-0000-0000-000000000002", state,
        draft_artifact_id: state === "drafted" ? "draft-existing" : null,
        expires_at: state === "drafted" ? null : "2026-09-14T10:00:00.000Z",
      });
      const p = ports({ rows: [...history(), held] });
      const offer = await extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });
      assert.deepEqual(offer.ideas.map((idea) => idea.artifactId), [IDEA_B.artifactId]);
      assert.equal(p.rows.at(-1).state, state);
      assert.equal(p.rows.at(-1).active_idea_key, IDEA_A.artifactId);
      assert.equal(p.rows.length, 1002);
      assert.deepEqual(p.calls.filter((call) => call.operation === "artifact_content_read")
        .map((call) => call.artifactId), [IDEA_B.artifactId]);
      assert.equal(p.calls.filter((call) => call.operation === "updateWhere").length, 0);
    });
  }
});
