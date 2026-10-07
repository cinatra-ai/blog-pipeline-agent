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

const TABLE = "idea_drafts";
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
        const selected = rows.filter((row) => matches(row, request));
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
        // The table's own one-live-row-per-idea rule, of which the race's only
        // arbiter is made: the collision is looked for across the organisation's
        // runs.
        const live = rows.find(
          (row) =>
            row.idea_artifact_id === request.row.idea_artifact_id && row.state !== "released",
        );
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
          ...request.row,
        };
        rows.push(written);
        return { inserted: true, row: { ...written } };
      },
      async updateWhere(request) {
        calls.push({ operation: "updateWhere", ...request });
        assert.equal(request.table, TABLE);
        assertBoundColumnsAreTheHosts(request);
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
      {},
      "the host narrows the read to the organisation; the module names no column of its own",
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
    assert.deepEqual(release.set, { state: "released", expires_at: null });
    assert.equal(release.where.idea_artifact_id, IDEA_A.artifactId);
    assert.equal(release.where.state, "reserved");
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
      ideaArtifactId: IDEA_B.artifactId,
      ideaRevisionId: IDEA_B.latestRepresentationRevisionId,
      ideaTitle: titleFromIdeaText(IDEA_B.text),
      reason: "",
    });
    const write = p.calls.find((c) => c.operation === "insertIfAbsent");
    assert.deepEqual(Object.keys(write.row).sort(), [
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
    assert.deepEqual(write.conflictKeys, ["idea_artifact_id", "state"]);
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0][RUN_COLUMN], BOUND_RUN, "the host stamped the run, not the module");
  });

  it("completes its reservation into the relation, keyed by the run alone", async () => {
    const p = unanchoredPorts({ rows: [reserved(IDEA_A.artifactId)] });
    const result = await extensionTool({
      input: {
        op: "complete",
        ideaType: IDEA_TYPE,
        ideaArtifactId: IDEA_A.artifactId,
        draftArtifactId: "draft-1",
        reviewTargets: "[]",
      },
      ports: p,
    });
    assert.deepEqual(result, { ok: true });
    const write = p.calls.find((c) => c.operation === "updateWhere");
    assert.deepEqual(write.where, { idea_artifact_id: IDEA_A.artifactId, [RUN_COLUMN]: { boundRun: true } });
    assert.equal(p.rows[0].state, "drafted");
  });
});
