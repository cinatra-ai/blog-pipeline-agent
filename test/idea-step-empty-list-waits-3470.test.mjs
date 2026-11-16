/**
 * AN EMPTY IDEA LIST KEEPS THE RUN WAITING, AND THE MESSAGE SAYS HOW TO LEAVE IT
 * (cinatra-ai/cinatra#3470).
 *
 * The product draws the idea step from the list screen this package declares
 * (design app-artifact-review I.1). With no idea on offer it draws the declared
 * empty-state message as written, keeps its one Continue unavailable, and the
 * run waits at the step: the package declares no no-pick answer, so nothing
 * answers the step for the person. The run cannot go on from there, so the
 * message says so and tells the person to cancel the run. It still never
 * promises a new list in this run, and it still says where new ideas come from.
 * The gate's own sentence for an empty offer is the same text.
 *
 *   node --test test/idea-step-empty-list-waits-3470.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { offerStoredIdeas } from "../src/lib/blog/stored-ideas-gate.ts";

const BINDING_ID = "@cinatra-ai/blog-pipeline-agent:idea-selection";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function theScreen() {
  const bindings = manifest.cinatra?.fieldRenderers ?? [];
  const matching = bindings.filter((b) => b && b.id === BINDING_ID);
  assert.equal(matching.length, 1, "exactly one binding carries the idea step");
  return matching[0].screen;
}

/** The declared message and the gate's sentence for an empty offer. */
function theSentences() {
  const declared = theScreen()?.emptyStateMessage;
  assert.equal(typeof declared, "string", "an empty-state message is declared");
  const offer = offerStoredIdeas({ candidates: [], takenArtifactIds: [] });
  assert.equal(offer.ok, false, "an empty offer is no list to pick from");
  if (offer.ok) return [declared];
  assert.equal(offer.reason, declared, "the gate's sentence is the declared message, word for word");
  return [declared, offer.reason];
}

describe("an empty idea list", () => {
  it("the screen declares no answer for an empty list, so the run waits at the step", () => {
    const screen = theScreen();
    assert.ok(!Object.prototype.hasOwnProperty.call(screen, "noPickAnswer"), "no no-pick answer is declared");
    assert.ok(screen.picks === undefined || screen.picks === "one", "one idea is picked, never several");
  });

  it("the message says this run cannot go on from the step", () => {
    for (const text of theSentences()) {
      assert.match(text, /this run cannot go on/i, "the person reads that the run does not go on from here");
    }
  });

  it("the message tells the person to cancel the run", () => {
    for (const text of theSentences()) {
      assert.match(text, /\bcancel it\b/i, "the one way out of the waiting run is named");
    }
  });

  it("the message never says the run ends or goes on by itself", () => {
    for (const text of theSentences()) {
      assert.doesNotMatch(text, /\bthe run ends\b|\bends the run\b|\bends here\b/i);
      assert.doesNotMatch(text, /\bcontinue\b/i, "no Continue is offered on an empty list");
    }
  });

  it("the message never promises a new list in this run, and says where new ideas come from", () => {
    for (const text of theSentences()) {
      assert.match(text, /does not change/i, "the list is read once, when the run reaches the step");
      assert.doesNotMatch(text, /open this step again|refresh|reload/i);
      assert.match(text, /generate new ideas/i);
      assert.match(text, /the next run of this pipeline offers them/i);
    }
  });

  it("the message is plain ASCII text of at most 600 characters", () => {
    for (const text of theSentences()) {
      assert.ok(text.length <= 600, "at most 600 characters");
      assert.match(text, /^[\x20-\x7e]+$/, "printable ASCII on one line");
    }
  });
});
