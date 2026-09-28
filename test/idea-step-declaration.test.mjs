/**
 * THE IDEA STEP'S DECLARED WORDS.
 *
 * The host draws the stored-ideas step from what this pack declares on its one
 * field-renderer binding: the question the step asks, and the message it shows
 * when the declared list is empty. The run waits at that step, so the message
 * never sends the reader away to start the pipeline again, and the list is read
 * once when the run reaches the step, so the message never promises a new list
 * on reopening it. The sentence the gate returns for an empty offer is the
 * declared message, word for word.
 *
 *   node --test test/idea-step-declaration.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { offerStoredIdeas } from "../src/lib/blog/stored-ideas-gate.ts";

const BINDING_ID = "@cinatra-ai/blog-pipeline-agent:idea-selection";
const MAX_PARAMS_JSON_BYTES = 2048;

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function theBinding() {
  const bindings = manifest.cinatra?.fieldRenderers ?? [];
  const matching = bindings.filter((b) => b && b.id === BINDING_ID);
  assert.equal(matching.length, 1, "exactly one binding carries the idea step");
  return matching[0];
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

describe("the idea step's declared words", () => {
  it("the one binding carries a question and an empty-state message as plain JSON", () => {
    const binding = theBinding();
    const params = binding.params;
    assert.ok(isPlainObject(params), "params is a plain object");
    assert.deepEqual(Object.keys(params).sort(), ["emptyStateMessage", "question"]);
    for (const key of ["question", "emptyStateMessage"]) {
      assert.equal(typeof params[key], "string", `${key} is a string`);
      assert.notEqual(params[key].trim(), "", `${key} is not blank`);
    }
    const serialized = JSON.stringify(params);
    assert.ok(
      Buffer.byteLength(serialized, "utf8") <= MAX_PARAMS_JSON_BYTES,
      "params serialize to 2048 bytes or less",
    );
    assert.equal(JSON.stringify(JSON.parse(serialized)), serialized, "params round-trip as plain JSON");
  });

  it("the sentence an empty offer returns is the declared message, word for word", () => {
    const declared = theBinding().params?.emptyStateMessage;
    const offer = offerStoredIdeas({ candidates: [], takenArtifactIds: [] });
    assert.equal(offer.ok, false);
    if (offer.ok) return;
    assert.equal(offer.reason, declared);
  });

  it("the message never sends the reader away from a run that waits, and never promises a new list", () => {
    const declared = theBinding().params?.emptyStateMessage;
    const offer = offerStoredIdeas({ candidates: [], takenArtifactIds: [] });
    assert.equal(offer.ok, false);
    if (offer.ok) return;
    assert.equal(typeof declared, "string", "an empty-state message is declared");
    for (const text of [offer.reason, declared]) {
      assert.doesNotMatch(text, /start the pipeline/i);
      assert.doesNotMatch(text, /open this step again|refresh/i);
    }
  });
});
