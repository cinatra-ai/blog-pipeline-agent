/**
 * THE IDEA STEP'S PICK IS DECLARED REQUIRED, AND THE EMPTY LIST STILL HAS A ROAD OUT.
 *
 * The host keeps a mid-run gate's Continue unavailable while a property that the
 * gate's `inputMessageSchema` marks `"x-required": true` has no value from the
 * gate's renderer (cinatra-ai/cinatra#4436). The idea step declares its one
 * property, `selectedIdeaJson`, that way, with no `default`: a property with a
 * `default` counts as answered, and then nothing holds the Continue.
 *
 * With no idea on offer the renderer answers the pick with its no-pick value. The
 * step after the gate (the reserve operation of the stored-ideas tool) must never
 * read that value as a pick: it returns a reason and writes no reservation, both
 * for the empty list and for a list that holds ideas. The same holds for the
 * pure decision module the pack's own runner uses (`resolveIdeaPick` in
 * src/lib/blog/stored-ideas-gate.ts).
 *
 *   node --test test/idea-pick-required.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { extensionTool } from "../cinatra/tools/stored-ideas.mjs";
import { resolveIdeaPick } from "../src/lib/blog/stored-ideas-gate.ts";

const OAS = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const GATE = OAS.$referenced_components.idea_selection_gate;
const IDEA_TYPE = "@cinatra-ai/blog-idea-artifact:blog-idea";
const RENDERER_URL = new URL("../src/renderers/idea-selection.ts", import.meta.url);

/** The renderer's own no-pick value, read from its module, never retyped here. */
async function noPickValue() {
  const mod = await import(RENDERER_URL.href);
  assert.equal(typeof mod.NO_PICK_JSON, "string", "the renderer exports its no-pick value");
  return mod.NO_PICK_JSON;
}

/** Ports that record every call; a refused pick must make none of them. */
function recordingPorts() {
  const calls = [];
  const record = (operation) => async (request) => {
    calls.push({ operation, request });
    return { inserted: true, row: { claim_id: "claim-under-test" } };
  };
  return {
    calls,
    ports: {
      clock: {
        now() {
          calls.push({ operation: "clock.now" });
          return new Date("2026-10-30T00:00:00.000Z");
        },
      },
      data: {
        select: record("select"),
        insertIfAbsent: record("insertIfAbsent"),
        updateWhere: record("updateWhere"),
      },
    },
  };
}

const OFFERED = [
  {
    artifactId: "idea-a",
    representationRevisionId: "rev-a",
    title: "Shipping on Fridays",
    text: "Shipping on Fridays\nWhy a Friday deploy is a habit, not a risk.",
  },
];

describe("the idea step's schema", () => {
  it("declares selectedIdeaJson with the literal x-required true and no default", () => {
    const schema = GATE.metadata.cinatra.inputMessageSchema;
    const property = schema.properties.selectedIdeaJson;
    assert.ok(property && typeof property === "object", "the gate declares selectedIdeaJson");
    assert.equal(property["x-required"], true, "the pick is declared x-required, as the literal true");
    assert.ok(
      !Object.prototype.hasOwnProperty.call(property, "default"),
      "the pick declares no default, which the host would read as an answer",
    );
  });

  it("no longer says that the pick is not a required field", () => {
    const description = GATE.metadata.cinatra.description;
    assert.equal(typeof description, "string");
    assert.doesNotMatch(description, /not a required field/i);
    assert.match(description, /x-required/, "the description names the declaration");
  });
});

describe("the no-pick value at the reserve step", () => {
  it("names no idea", async () => {
    const parsed = JSON.parse(await noPickValue());
    assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    assert.ok(!("artifactId" in parsed), "it names no artifact");
    assert.ok(!("representationRevisionId" in parsed), "it names no revision");
  });

  for (const [name, offered] of [
    ["an empty offered list", []],
    ["an offered list that holds an idea", OFFERED],
  ]) {
    it(`with ${name}, returns a reason and writes no reservation`, async () => {
      const pick = await noPickValue();
      const { calls, ports } = recordingPorts();
      const result = await extensionTool({
        input: { op: "reserve", ideaType: IDEA_TYPE, pick, offered: JSON.stringify(offered) },
        ports,
      });
      assert.equal(typeof result.reason, "string");
      assert.notEqual(result.reason.trim(), "", "the run ends with a plain reason");
      assert.ok(!("claimId" in result), "nothing was reserved");
      assert.ok(!("idea" in result), "no idea was handed on");
      assert.deepEqual(calls, [], "no row was read or written");
    });
  }
});

describe("the no-pick value at the pack's own decision module", () => {
  for (const [name, offered] of [
    ["an empty offered list", []],
    ["an offered list that holds an idea", OFFERED],
  ]) {
    it(`resolveIdeaPick, with ${name}, refuses it with a reason`, async () => {
      const outcome = resolveIdeaPick({ pick: await noPickValue(), offered });
      assert.equal(outcome.ok, false, "the no-pick value is never a pick");
      assert.ok(!("idea" in outcome), "no idea is resolved");
      assert.equal(typeof outcome.reason, "string");
      assert.notEqual(outcome.reason.trim(), "", "the run ends with a plain reason");
    });
  }
});
