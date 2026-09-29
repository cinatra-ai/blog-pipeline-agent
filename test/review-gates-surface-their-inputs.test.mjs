// cinatra#3035 — the two later pauses hand over what they are drawn from.
//
// The three arms pin: the review of the post opts the target set its marker
// names into its surface (`surfaceGateInputs: true`, the flag the idea step
// already carries); the LinkedIn step opts the post the writer made into its
// surface; and the LinkedIn step's one field is keyed by the input that
// carries that post, so the field opens holding it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const oas = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const parts = oas.$referenced_components;

test("the review of the post surfaces the target set its marker names", () => {
  const gate = parts.draft_review_gate;
  const marker = gate.metadata.cinatra.artifactReview?.targetsInput;
  assert.equal(marker, "reviewTargets", "the marker names the input the targets travel in");
  assert.ok(
    (gate.inputs ?? []).some((i) => i.title === marker),
    "and the gate declares that input",
  );
  assert.equal(
    gate.metadata.cinatra.surfaceGateInputs,
    true,
    "so the gate opts the target set into its surface",
  );
});

test("the LinkedIn step surfaces the post the writer made", () => {
  const gate = parts.linkedin_review_gate;
  assert.equal(
    gate.metadata.cinatra.surfaceGateInputs,
    true,
    "so the gate opts the post into its surface",
  );
});

test("the LinkedIn step's one field is the post itself, keyed by the input that carries it", () => {
  const gate = parts.linkedin_review_gate;
  const schema = gate.metadata.cinatra.inputMessageSchema;
  assert.deepEqual(Object.keys(schema.properties), ["linkedinPost"]);
  assert.equal(schema.properties.linkedinPost.type, "string");
  assert.equal(schema.properties.linkedinPost.title, "The LinkedIn post");
  assert.deepEqual(schema.required, ["linkedinPost"]);
  assert.ok(
    (gate.inputs ?? []).some((i) => i.title === "linkedinPost"),
    "the field's key is the declared input the writer's post arrives in",
  );
});
