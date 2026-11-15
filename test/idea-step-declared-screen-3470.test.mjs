/**
 * THE IDEA STEP IS DECLARED, AND THE PRODUCT DRAWS IT (cinatra-ai/cinatra#3470).
 *
 * An agent package does not draw its own HITL screens. It declares each screen
 * in its manifest, and the product draws it with its own components. The idea
 * step is a list step: the binding declares `screen` with the "list" layout,
 * and the package ships no component of its own for it.
 *
 * These arms pin:
 * - the binding declares no `component`, and declares a `screen` whose layout
 *   is "list", in the shape the product's list step reads (every key named,
 *   nothing else);
 * - the screen reads the entries the gate surfaces (`ideas`), offers an entry
 *   only when it carries both halves of its reference, and stages the pick
 *   under the gate's one declared property (`selectedIdeaJson`) and the resume
 *   text (`userResponse`);
 * - the pick the screen stages is the one the reserve step accepts: the
 *   reference object of an offered idea, as JSON text, in the declared key
 *   order;
 * - one person picks one idea: no several-pick, no declared no-pick answer and
 *   no retry, so an empty list keeps the step waiting, as the approved drawing
 *   of the list step shows;
 * - the empty-state message is the gate's own sentence for an empty offer,
 *   word for word;
 * - the package ships nothing that draws: no renderer module, no component
 *   file, no copy of a product primitive, no React peer.
 *
 *   node --test test/idea-step-declared-screen-3470.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { offerStoredIdeas, resolveIdeaPick } from "../src/lib/blog/stored-ideas-gate.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BINDING_ID = "@cinatra-ai/blog-pipeline-agent:idea-selection";
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_TEXT = 600;
const MAX_SCREEN_BYTES = 8192;
const LIST_KEYS = [
  "answerKeys",
  "detail",
  "emptyStateMessage",
  "failed",
  "items",
  "layout",
  "pickKeys",
  "picks",
  "question",
  "title",
];

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const OAS = JSON.parse(readFileSync(join(ROOT, "cinatra", "oas.json"), "utf8"));
const GATE = OAS.$referenced_components.idea_selection_gate;

function theBinding() {
  const bindings = manifest.cinatra?.fieldRenderers ?? [];
  const matching = bindings.filter((b) => b && b.id === BINDING_ID);
  assert.equal(matching.length, 1, "exactly one binding carries the idea step");
  return matching[0];
}

function theScreen() {
  const screen = theBinding().screen;
  assert.ok(
    screen !== null && typeof screen === "object" && !Array.isArray(screen),
    "the binding declares a screen as a plain object",
  );
  return screen;
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT;
}

const IDEAS = [
  {
    artifactId: "idea-artifact-first",
    representationRevisionId: "idea-revision-first",
    title: "Why small teams ship faster",
    text: "Why small teams ship faster\nA short look at how fewer hand-offs shorten the road to a release.",
  },
  {
    artifactId: "idea-artifact-second",
    representationRevisionId: "idea-revision-second",
    title: "Writing a changelog people read",
    text: "Writing a changelog people read\nWhat to leave out, and what to say first.",
  },
];

describe("the idea step's binding", () => {
  it("declares no component of its own", () => {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(theBinding(), "component"),
      "the binding names no component; the product draws the step",
    );
  });

  it("keeps its kind and stays a mid-run screen", () => {
    const binding = theBinding();
    assert.equal(binding.kind, "blog-idea-selection");
    assert.equal(binding.midRunHitl, true);
  });

  it("declares a list screen in the shape the product's list step reads", () => {
    const screen = theScreen();
    assert.equal(screen.layout, "list");
    for (const key of Object.keys(screen)) {
      assert.ok(LIST_KEYS.includes(key), `the list screen names no unknown key (${key})`);
    }
    assert.ok(isText(screen.question), "the question is non-blank text of at most 600 characters");
    assert.ok(
      isText(screen.emptyStateMessage),
      "the empty-state message is non-blank text of at most 600 characters",
    );
    for (const key of ["items", "title", "detail"]) {
      assert.match(screen[key], KEY_RE, `${key} names a run-value key`);
    }
    for (const list of ["pickKeys", "answerKeys"]) {
      assert.ok(Array.isArray(screen[list]) && screen[list].length > 0, `${list} is a non-empty list`);
      for (const key of screen[list]) assert.match(key, KEY_RE, `${list} names keys only`);
    }
    const serialized = JSON.stringify(screen);
    assert.ok(Buffer.byteLength(serialized, "utf8") <= MAX_SCREEN_BYTES, "the screen serializes to 8192 bytes or less");
    assert.equal(JSON.stringify(JSON.parse(serialized)), serialized, "the screen round-trips as plain JSON");
  });

  it("asks the step's question", () => {
    assert.equal(theScreen().question, "Which stored blog idea should this run draft?");
  });

  it("reads the ideas the gate surfaces and offers an entry only with both halves of its reference", () => {
    const screen = theScreen();
    assert.equal(GATE.metadata.cinatra.surfaceGateInputs, true, "the gate surfaces its inputs to the step");
    assert.equal(screen.items, "ideas");
    assert.equal(screen.title, "text", "the row title is the first line of the idea's text");
    assert.equal(screen.detail, "text", "the detail line is the rest of the idea's text");
    assert.deepEqual(screen.pickKeys, ["artifactId", "representationRevisionId"]);
  });

  it("stages the pick under the gate's one declared property and the resume text", () => {
    const screen = theScreen();
    const declared = Object.keys(GATE.metadata.cinatra.inputMessageSchema.properties);
    assert.deepEqual(declared, ["selectedIdeaJson"]);
    assert.deepEqual(screen.answerKeys, ["selectedIdeaJson", "userResponse"]);
  });

  it("one person picks one idea: no several-pick, no declared no-pick answer, no retry", () => {
    const screen = theScreen();
    assert.ok(screen.picks === undefined || screen.picks === "one", "one idea is picked");
    for (const key of ["noPickAnswer", "retry", "failed"]) {
      assert.ok(!Object.prototype.hasOwnProperty.call(screen, key), `the screen declares no ${key}`);
    }
  });

  it("the empty-state message is the gate's sentence for an empty offer, word for word", () => {
    const offer = offerStoredIdeas({ candidates: [], takenArtifactIds: [] });
    assert.equal(offer.ok, false);
    if (offer.ok) return;
    assert.equal(theScreen().emptyStateMessage, offer.reason);
  });

  it("the pick the screen stages is the one the reserve step accepts", () => {
    const screen = theScreen();
    const chosen = IDEAS[1];
    const staged = JSON.stringify(Object.fromEntries(screen.pickKeys.map((k) => [k, chosen[k]])));
    const outcome = resolveIdeaPick({ pick: staged, offered: IDEAS });
    assert.equal(outcome.ok, true, "the staged reference resolves to the offered idea");
    if (!outcome.ok) return;
    assert.equal(outcome.idea.artifactId, chosen.artifactId);
    assert.equal(outcome.idea.representationRevisionId, chosen.representationRevisionId);
  });
});

describe("the package ships nothing that draws", () => {
  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else out.push(path.slice(ROOT.length));
    }
    return out;
  }

  it("has no renderer module, no component file and no copy of a product primitive", () => {
    assert.ok(!existsSync(join(ROOT, "src", "renderers")), "src/renderers is gone");
    assert.ok(!existsSync(join(ROOT, "src", "components")), "src/components is absent");
    const drawn = walk(join(ROOT, "src")).filter((p) => /\.(tsx|jsx)$/.test(p));
    assert.deepEqual(drawn, [], "no .tsx or .jsx file under src");
  });

  it("declares no React peer and no React or DOM test dependency", () => {
    for (const field of ["peerDependencies", "peerDependenciesMeta", "dependencies", "devDependencies"]) {
      const names = Object.keys(manifest[field] ?? {});
      for (const name of ["react", "react-dom", "@types/react", "jsdom"]) {
        assert.ok(!names.includes(name), `${field} names no ${name}`);
      }
    }
  });
});
