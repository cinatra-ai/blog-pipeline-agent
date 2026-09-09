/**
 * THE PIPELINE'S STORED-IDEAS GATE, tested in the pack that owns it.
 *
 * "A preparation step lists every blog-idea artifact of the organisation through
 * the dependency-scoped read road, reads each candidate's text — the first line
 * is its title — subtracts the ideas its relation table links to a draft or holds
 * reserved, and emits the rest as the message the existing gate renderer already
 * reads; the person picks exactly one; the pick is recorded by artifact id and
 * revision, validated against the offered list, and fails closed when the list is
 * missing — the renderer's silent first-idea default goes. The pick writes a
 * reservation row under a uniqueness rule that allows one live reservation or
 * relation per idea, so two runs that offer the same idea cannot both take it:
 * the second pick is refused at the gate. An empty list ends the run with a
 * stated reason instead of a pick."
 *
 * The gate's decision module and its prepare/reserve/complete/release flow live
 * in THIS repository, so this suite is the whole proof of them: the two fixtures
 * a live fleet cannot supply — "two runs picking the same idea at once" and "a
 * run that fails after its draft is written" — are ordinary tests here, because
 * every read and write the flow makes is a port.
 *
 *   node --test test/stored-ideas-gate.test.ts
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IDEA_RELATION_TABLE,
  IDEA_RELATION_TABLE_DECLARED,
  IdeaTypeRefusal,
  declaredTablePhysicalName,
  isIdeaTypeRefusal,
  offerStoredIdeas,
  parseOfferedIdeas,
  requireIdeaType,
  resolveIdeaPick,
  titleFromIdeaText,
} from "../src/lib/blog/stored-ideas-gate.ts";
import {
  completeIdeaRelation,
  prepareStoredIdeas,
  releaseIdeaReservation,
  reserveStoredIdea,
  type StoredIdeasPorts,
} from "../src/lib/blog/stored-ideas-gate-runner.ts";

const IDEA_A = {
  artifactId: "idea-a",
  representationRevisionId: "rev-a",
  text: "Title: Shipping on Fridays\n\nWhy a Friday deploy is a habit, not a risk.",
};
const IDEA_B = {
  artifactId: "idea-b",
  representationRevisionId: "rev-b",
  text: "Reading a run's own page\n\nWhat a run should show when it is done.",
};

/** The subset check `toMatchObject` gave the suite this one is ported from. */
function matchesObject(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, `row.${key}`);
  }
}

function ports(overrides: Partial<StoredIdeasPorts> = {}): StoredIdeasPorts {
  const rows: Array<Record<string, unknown>> = [];
  return {
    async listIdeaArtifacts() {
      return [
        { artifactId: IDEA_A.artifactId, representationRevisionId: IDEA_A.representationRevisionId },
        { artifactId: IDEA_B.artifactId, representationRevisionId: IDEA_B.representationRevisionId },
      ];
    },
    async readIdeaText(artifactId) {
      return artifactId === IDEA_A.artifactId ? IDEA_A.text : IDEA_B.text;
    },
    async listRelationRows() {
      return rows;
    },
    async insertRelationRow(row) {
      const live = rows.find(
        (r) => r.idea_artifact_id === row.idea_artifact_id && r.state !== "released",
      );
      if (live) return { ok: false as const, conflict: true as const };
      rows.push({ ...row });
      return { ok: true as const };
    },
    async updateRelationRow(keys, patch) {
      const row = rows.find(
        (r) => r.run_id === keys.run_id && r.idea_artifact_id === keys.idea_artifact_id,
      );
      if (!row) return { ok: false as const, conflict: false as const };
      Object.assign(row, patch);
      return { ok: true as const };
    },
    ...overrides,
  };
}

describe("the idea's title is the first line of its text", () => {
  it("reads a bare first line as the title", () => {
    assert.equal(titleFromIdeaText(IDEA_B.text), "Reading a run's own page");
  });
  it("strips the Title: prefix the idea generator writes", () => {
    assert.equal(titleFromIdeaText(IDEA_A.text), "Shipping on Fridays");
  });
  it("has no title for text with no first line", () => {
    assert.equal(titleFromIdeaText("   \n\nbody"), "");
  });
});

describe("the offered list", () => {
  it("offers every idea no draft has used and none holds reserved", () => {
    const offer = offerStoredIdeas({
      candidates: [IDEA_A, IDEA_B],
      takenArtifactIds: [],
    });
    assert.equal(offer.ok, true);
    if (!offer.ok) return;
    assert.deepEqual(offer.ideas.map((i) => i.artifactId), ["idea-a", "idea-b"]);
    assert.equal(offer.ideas[0].title, "Shipping on Fridays");
    assert.equal(offer.ideas[0].representationRevisionId, "rev-a");
  });

  it("subtracts an idea a draft has used or a run holds reserved", () => {
    const offer = offerStoredIdeas({
      candidates: [IDEA_A, IDEA_B],
      takenArtifactIds: ["idea-a"],
    });
    assert.equal(offer.ok, true);
    if (!offer.ok) return;
    assert.deepEqual(offer.ideas.map((i) => i.artifactId), ["idea-b"]);
  });

  it("ends the run with a stated reason when nothing is left to offer", () => {
    const offer = offerStoredIdeas({
      candidates: [IDEA_A],
      takenArtifactIds: ["idea-a"],
    });
    assert.equal(offer.ok, false);
    if (offer.ok) return;
    assert.match(offer.reason, /no blog idea/i);
    assert.match(offer.reason, /draft/i);
  });
});

describe("the pick", () => {
  const offered = [
    { artifactId: "idea-a", representationRevisionId: "rev-a", title: "A", text: "A" },
    { artifactId: "idea-b", representationRevisionId: "rev-b", title: "B", text: "B" },
  ];

  it("records the pick by artifact id and revision", () => {
    const picked = resolveIdeaPick({
      pick: JSON.stringify({ artifactId: "idea-b", representationRevisionId: "rev-b" }),
      offered,
    });
    assert.deepEqual(picked, { ok: true, idea: offered[1] });
  });

  it("never picks the first idea for a person who picked nothing", () => {
    for (const nothing of ["", "   ", "{}", "null", undefined]) {
      const picked = resolveIdeaPick({ pick: nothing, offered });
      assert.equal(picked.ok, false);
    }
  });

  it("refuses a pick that is not on the offered list", () => {
    const picked = resolveIdeaPick({
      pick: JSON.stringify({ artifactId: "idea-z", representationRevisionId: "rev-z" }),
      offered,
    });
    assert.equal(picked.ok, false);
    if (picked.ok) return;
    assert.match(picked.reason, /offered/i);
  });

  it("refuses a pick on a revision the list did not offer", () => {
    const picked = resolveIdeaPick({
      pick: JSON.stringify({ artifactId: "idea-a", representationRevisionId: "rev-old" }),
      offered,
    });
    assert.equal(picked.ok, false);
  });

  it("fails closed when there is no offered list to validate against", () => {
    const picked = resolveIdeaPick({
      pick: JSON.stringify({ artifactId: "idea-a", representationRevisionId: "rev-a" }),
      offered: [],
    });
    assert.equal(picked.ok, false);
  });
});

describe("the offered list as the flow actually sends it", () => {
  // The pipeline flow reserves through an ApiNode whose `offered` field is the
  // template `{{ ideas | tojson }}` and whose `pick` field is one InputMessageNode
  // string: BOTH arrive as JSON TEXT, never as an array and an object. The pick
  // side was already read back that way; the offered side was not, so every real
  // reservation refused itself with "no offered list to validate a pick against"
  // and no idea could ever be taken. (#52.)
  const ideas = [
    { artifactId: "idea-a", representationRevisionId: "rev-a", title: "A", text: "A" },
    { artifactId: "idea-b", representationRevisionId: "rev-b", title: "B", text: "B" },
  ];

  it("reads back an offered list the flow encoded as JSON text", () => {
    assert.deepEqual(parseOfferedIdeas(JSON.stringify(ideas)), ideas);
  });

  it("passes an offered list that is already an array straight through", () => {
    assert.deepEqual(parseOfferedIdeas(ideas), ideas);
  });

  it("offers nothing at all when the field is missing or unreadable", () => {
    for (const nothing of [undefined, null, "", "   ", "not json", "{}", 42]) {
      assert.deepEqual(parseOfferedIdeas(nothing), []);
    }
  });

  it("drops an element that is not a usable idea reference", () => {
    const mixed = JSON.stringify([ideas[0], { artifactId: "idea-x" }, null, "idea-y"]);
    assert.deepEqual(parseOfferedIdeas(mixed), [ideas[0]]);
  });

  it("resolves the run's pick against the encoded list the same call carried", () => {
    const picked = resolveIdeaPick({
      pick: JSON.stringify({ artifactId: "idea-b", representationRevisionId: "rev-b" }),
      offered: parseOfferedIdeas(JSON.stringify(ideas)),
    });
    assert.deepEqual(picked, { ok: true, idea: ideas[1] });
  });
});

describe("the reservation row and its uniqueness rule", () => {
  it("prepares the offer from the dependency-scoped listing and one content read per idea", async () => {
    const reads: string[] = [];
    const p = ports({
      async readIdeaText(artifactId) {
        reads.push(artifactId);
        return artifactId === IDEA_A.artifactId ? IDEA_A.text : IDEA_B.text;
      },
    });
    const out = await prepareStoredIdeas({ ports: p, orgId: "org-1", runId: "run-1" });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.ideas.length, 2);
    assert.deepEqual(reads, ["idea-a", "idea-b"]);
  });

  it("writes one reservation row on the pick", async () => {
    const p = ports();
    const taken = await reserveStoredIdea({
      ports: p,
      orgId: "org-1",
      runId: "run-1",
      idea: { artifactId: "idea-a", representationRevisionId: "rev-a", title: "A", text: "A" },
    });
    assert.equal(taken.ok, true);
    const rows = await p.listRelationRows();
    assert.equal(rows.length, 1);
    matchesObject(rows[0], {
      idea_artifact_id: "idea-a",
      idea_revision_id: "rev-a",
      run_id: "run-1",
      org_id: "org-1",
      state: "reserved",
    });
  });

  it("refuses the losing pick when two runs take the same idea at once", async () => {
    const p = ports();
    const idea = {
      artifactId: "idea-a",
      representationRevisionId: "rev-a",
      title: "A",
      text: "A",
    };
    const first = await reserveStoredIdea({ ports: p, orgId: "org-1", runId: "run-1", idea });
    const second = await reserveStoredIdea({ ports: p, orgId: "org-1", runId: "run-2", idea });
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.reason, /just taken/i);
  });

  it("hides an idea another run reserved from the next run's list", async () => {
    const p = ports();
    await reserveStoredIdea({
      ports: p,
      orgId: "org-1",
      runId: "run-1",
      idea: { artifactId: "idea-a", representationRevisionId: "rev-a", title: "A", text: "A" },
    });
    const out = await prepareStoredIdeas({ ports: p, orgId: "org-1", runId: "run-2" });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.ideas.map((i) => i.artifactId), ["idea-b"]);
  });

  it("completes the reservation into the relation row, and a retry completes the same row", async () => {
    const p = ports();
    const idea = {
      artifactId: "idea-a",
      representationRevisionId: "rev-a",
      title: "A",
      text: "A",
    };
    await reserveStoredIdea({ ports: p, orgId: "org-1", runId: "run-1", idea });
    const completed = await completeIdeaRelation({
      ports: p,
      orgId: "org-1",
      runId: "run-1",
      ideaArtifactId: "idea-a",
      draftArtifactId: "draft-1",
    });
    const retried = await completeIdeaRelation({
      ports: p,
      orgId: "org-1",
      runId: "run-1",
      ideaArtifactId: "idea-a",
      draftArtifactId: "draft-1",
    });
    // The retry completes the SAME row and reports the same success: a completion
    // that only ever lands once would leave a retried run without its relation.
    assert.equal(completed.ok, true);
    assert.equal(retried.ok, true);
    const rows = await p.listRelationRows();
    assert.equal(rows.length, 1);
    matchesObject(rows[0], { state: "drafted", draft_artifact_id: "draft-1" });
  });

  it("names the table under the pipeline extension's own prefix", () => {
    assert.equal(IDEA_RELATION_TABLE, "ext_cinatra_ai_blog_pipeline_agent_idea_drafts");
  });

  it("ends a run with a stated reason when the organisation has no stored idea at all", async () => {
    const out = await prepareStoredIdeas({
      ports: ports({ async listIdeaArtifacts() { return []; } }),
      orgId: "org-1",
      runId: "run-1",
    });
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.match(out.reason, /no blog idea/i);
  });
});

describe("releasing a reservation leaves a completed relation alone", () => {
  // "A row already completed into a relation is NOT released - the update names
  // the reserved state, so a drafted row is left alone." The release keys carry
  // that state, so a lapse or a failure sweeping a run's reservation cannot undo
  // the relation a finished draft already wrote and hand its idea back to the
  // list while the draft still stands. (#52.)
  function keyRecordingPorts() {
    const seen: Array<Record<string, unknown>> = [];
    const patches: Array<Record<string, unknown>> = [];
    const ports = {
      listIdeaArtifacts: async () => [],
      readIdeaText: async () => null,
      listRelationRows: async () => [],
      insertRelationRow: async () => ({ ok: true }) as const,
      updateRelationRow: async (keys: Record<string, unknown>, patch: Record<string, unknown>) => {
        seen.push(keys);
        patches.push(patch);
        return { ok: true } as const;
      },
    } as unknown as StoredIdeasPorts;
    return { ports, seen, patches };
  }

  it("names the reserved state in the keys it releases on", async () => {
    const { ports, seen, patches } = keyRecordingPorts();
    await releaseIdeaReservation({ ports, runId: "run-1", ideaArtifactId: "idea-a" });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], {
      run_id: "run-1",
      idea_artifact_id: "idea-a",
      state: "reserved",
    });
    // What the release WRITES, not only what it keys on: a release that named the
    // reserved state and wrote nothing would leave the idea off the list for ever.
    assert.deepEqual(patches[0], { state: "released", expires_at: null });
  });

  it("still keys a completion by run and idea alone, so a retry completes it", async () => {
    const { ports, seen, patches } = keyRecordingPorts();
    await completeIdeaRelation({
      ports,
      orgId: "org-1",
      runId: "run-1",
      ideaArtifactId: "idea-a",
      draftArtifactId: "draft-a",
    });
    assert.deepEqual(seen[0], { run_id: "run-1", idea_artifact_id: "idea-a" });
    assert.deepEqual(patches[0], {
      state: "drafted",
      draft_artifact_id: "draft-a",
      expires_at: null,
    });
  });
});

describe("the relation the pack declares is the relation the gate names", () => {
  // The physical name is DERIVED from the declared one, so the pair cannot drift:
  // the manifest declares `idea_drafts`, and the gate names the same table under
  // this package's own derived prefix. Nothing writes either name twice.
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    name: string;
    cinatra: { declaredTables?: Array<{ name: string; organizationColumn: string; columns: Array<{ name: string }>; indexes: Array<{ name: string; columns: string[]; unique?: boolean }> }> };
  };

  it("declares the idea-drafts relation in its own manifest", () => {
    const declared = manifest.cinatra.declaredTables ?? [];
    const table = declared.find((t) => t.name === IDEA_RELATION_TABLE_DECLARED);
    assert.ok(table, `the manifest declares a table named ${IDEA_RELATION_TABLE_DECLARED}`);
    assert.equal(table.organizationColumn, "org_id");
    assert.deepEqual(
      table.columns.map((c) => c.name).sort(),
      [
        "created_at",
        "draft_artifact_id",
        "expires_at",
        "idea_artifact_id",
        "idea_revision_id",
        "org_id",
        "run_id",
        "state",
      ],
    );
  });

  it("declares the one-live-row-per-idea uniqueness rule the reservation leans on", () => {
    const table = (manifest.cinatra.declaredTables ?? []).find(
      (t) => t.name === IDEA_RELATION_TABLE_DECLARED,
    );
    assert.ok(table);
    const unique = table.indexes.filter((i) => i.unique === true);
    assert.deepEqual(unique.map((i) => i.name), ["idea_drafts_one_live"]);
    // The COLUMNS are the rule: an index of that name over anything else would not
    // make two runs' picks of one idea collide.
    assert.deepEqual(unique[0].columns, ["org_id", "idea_artifact_id", "state"]);
  });

  it("refuses a declared name whose derived table name does not fit an identifier", () => {
    assert.throws(
      () => declaredTablePhysicalName("x".repeat(64)),
      /over the 63-byte identifier limit/,
    );
  });

  it("derives the physical name from the declared one under this package's prefix", () => {
    assert.equal(
      IDEA_RELATION_TABLE,
      `ext_${manifest.name.replace(/^@/, "").replace(/[^a-z0-9_]/g, "_")}_${IDEA_RELATION_TABLE_DECLARED}`,
    );
  });
});

describe("the calling extension names the artifact type its ideas are filed under", () => {
  // The refusal carried over from the host passthrough word for word: a call that
  // names no type is refused rather than widened to every type the extension may
  // read — the offer would then be a list of posts and pictures.
  it("returns the type the caller named", () => {
    assert.equal(requireIdeaType({ ideaType: "@cinatra-ai/blog-idea-artifact:idea" }), "@cinatra-ai/blog-idea-artifact:idea");
  });

  it("trims the type the caller named", () => {
    assert.equal(requireIdeaType({ ideaType: "  an-idea-type  " }), "an-idea-type");
  });

  it("is recognised by its shape, so a caller across the border reports the refusal", () => {
    let raised: unknown;
    try {
      requireIdeaType({});
    } catch (error) {
      raised = error;
    }
    assert.ok(isIdeaTypeRefusal(raised));
    // The shape survives the crossing that an instanceof check does not: an error
    // carrying the same name and reason is recognised without this class.
    assert.ok(
      isIdeaTypeRefusal({
        name: "IdeaTypeRefusal",
        reason: "invalid-request",
        message: "any",
      }),
    );
    for (const other of [
      undefined,
      null,
      new Error("plain"),
      { name: "IdeaTypeRefusal", message: "no reason" },
      { name: "SomethingElse", reason: "invalid-request", message: "wrong name" },
    ]) {
      assert.equal(isIdeaTypeRefusal(other), false);
    }
  });

  it("refuses a call that names no type, with the refusal it has always carried", () => {
    for (const nothing of [{}, { ideaType: "" }, { ideaType: "   " }, { ideaType: 42 }, { ideaType: null }]) {
      assert.throws(
        () => requireIdeaType(nothing as Record<string, unknown>),
        (error: unknown) => {
          assert.ok(error instanceof IdeaTypeRefusal);
          assert.equal(error.reason, "invalid-request");
          assert.equal(
            error.message,
            "blog_pipeline_ideas: `ideaType` is required — the calling extension names the artifact type " +
              "its ideas are filed under, and it must be one of its own declared dependencies",
          );
          return true;
        },
      );
    }
  });
});
