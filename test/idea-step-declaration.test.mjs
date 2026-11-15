/**
 * THE IDEA STEP'S DECLARED WORDS.
 *
 * The host draws the stored-ideas step from what this pack declares on its one
 * field-renderer binding, in the binding's declared list screen: the question
 * the step asks, and the message it shows when the declared list is empty. The run waits at that step, so the message
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
const MAX_TEXT = 600;

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
  it("the one binding's screen carries a question and an empty-state message as plain text", () => {
    const binding = theBinding();
    const screen = binding.screen;
    assert.ok(isPlainObject(screen), "the binding declares a screen as a plain object");
    for (const key of ["question", "emptyStateMessage"]) {
      assert.equal(typeof screen[key], "string", `${key} is a string`);
      assert.notEqual(screen[key].trim(), "", `${key} is not blank`);
      assert.ok(screen[key].length <= MAX_TEXT, `${key} is at most ${MAX_TEXT} characters`);
    }
    assert.ok(
      !Object.prototype.hasOwnProperty.call(binding, "params"),
      "the words live in the screen only, never in a second copy under params",
    );
  });

  it("the sentence an empty offer returns is the declared message, word for word", () => {
    const declared = theBinding().screen?.emptyStateMessage;
    const offer = offerStoredIdeas({ candidates: [], takenArtifactIds: [] });
    assert.equal(offer.ok, false);
    if (offer.ok) return;
    assert.equal(offer.reason, declared);
  });

  it("the message never sends the reader away from a run that waits, and never promises a new list", () => {
    const declared = theBinding().screen?.emptyStateMessage;
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
