/**
 * THE IDEA STEP'S RADIO GROUP MOVES WITH THE ARROW KEYS.
 *
 * The idea list is one radio group: Tab reaches exactly one of its radios (the
 * chosen one, else the first), and the arrow keys, Home and End move the focus
 * and the choice between the ideas. `nextIdeaIndex` names the idea a key moves
 * to; the static markup shows the one radio Tab reaches.
 *
 * Every module is loaded inside the arm that needs it, so a missing export
 * fails that arm and not the whole file.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ENTRY_URL = new URL("../src/renderers/idea-selection.ts", import.meta.url);

const IDEAS = [
  { artifactId: "idea-artifact-first", representationRevisionId: "idea-revision-first", title: "Why small teams ship faster" },
  { artifactId: "idea-artifact-second", representationRevisionId: "idea-revision-second", title: "Writing a changelog people read" },
  { artifactId: "idea-artifact-third", representationRevisionId: "idea-revision-third", title: "What a good release note leaves out" },
];

async function theHelper() {
  const mod = await import(ENTRY_URL.href);
  assert.equal(typeof mod.nextIdeaIndex, "function", "the module exports nextIdeaIndex");
  return mod.nextIdeaIndex;
}

const NAVIGATION_KEYS = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];

/** The JSON a choice of `idea` commits: its reference, artifact first. */
function committed(idea) {
  return JSON.stringify({ artifactId: idea.artifactId, representationRevisionId: idea.representationRevisionId });
}

async function theKeyMove() {
  const mod = await import(ENTRY_URL.href);
  assert.equal(typeof mod.ideaKeyMove, "function", "the module exports ideaKeyMove");
  return mod.ideaKeyMove;
}

describe("the idea step's radio group moves with the arrow keys (cinatra#3773)", () => {
  it("ArrowDown and ArrowRight move to the next idea and wrap from the last to the first", async () => {
    const nextIdeaIndex = await theHelper();
    for (const key of ["ArrowDown", "ArrowRight"]) {
      assert.equal(nextIdeaIndex(0, 3, key), 1, key);
      assert.equal(nextIdeaIndex(1, 3, key), 2, key);
      assert.equal(nextIdeaIndex(2, 3, key), 0, key);
    }
  });

  it("ArrowUp and ArrowLeft move to the previous idea and wrap from the first to the last", async () => {
    const nextIdeaIndex = await theHelper();
    for (const key of ["ArrowUp", "ArrowLeft"]) {
      assert.equal(nextIdeaIndex(2, 3, key), 1, key);
      assert.equal(nextIdeaIndex(1, 3, key), 0, key);
      assert.equal(nextIdeaIndex(0, 3, key), 2, key);
    }
  });

  it("Home moves to the first idea and End to the last", async () => {
    const nextIdeaIndex = await theHelper();
    for (const current of [0, 1, 2]) {
      assert.equal(nextIdeaIndex(current, 3, "Home"), 0, "Home from " + current);
      assert.equal(nextIdeaIndex(current, 3, "End"), 2, "End from " + current);
    }
  });

  it("a key that does not move between ideas names no idea", async () => {
    const nextIdeaIndex = await theHelper();
    for (const key of ["Tab", "Enter", " ", "Escape", "PageDown", "a"]) {
      assert.equal(nextIdeaIndex(1, 3, key), null, JSON.stringify(key));
    }
  });

  it("Tab reaches exactly one idea radio, the first, while none is chosen", async () => {
    const [{ createElement }, { renderToStaticMarkup }, mod] = await Promise.all([
      import("react"),
      import("react-dom/server"),
      import(ENTRY_URL.href),
    ]);
    const calls = [];
    const markup = renderToStaticMarkup(
      createElement(mod.default, { value: { ideas: IDEAS }, onChange: (next) => void calls.push(next) }),
    );
    const radios = [...markup.matchAll(/<button\b[^>]*\brole="radio"[^>]*>/g)].map((m) => m[0]);
    assert.equal(radios.length, 3);
    const tabIndexes = radios.map((tag) => tag.match(/\btabindex="(-?\d+)"/)?.[1] ?? null);
    assert.deepEqual(tabIndexes, ["0", "-1", "-1"]);
    assert.equal(markup.match(/\btabindex="0"/g)?.length ?? 0, 1);
    assert.equal(calls.length, 0);
  });

  it("Tab reaches the chosen idea radio, and the first when the choice lies outside the offered ideas", async () => {
    const mod = await import(ENTRY_URL.href);
    assert.equal(typeof mod.tabbableIdeaIndex, "function", "the module exports tabbableIdeaIndex");
    assert.equal(mod.tabbableIdeaIndex(null, 3), 0);
    assert.equal(mod.tabbableIdeaIndex(1, 3), 1);
    assert.equal(mod.tabbableIdeaIndex(2, 3), 2);
    assert.equal(mod.tabbableIdeaIndex(2, 2), 0);
    assert.equal(mod.tabbableIdeaIndex(5, 2), 0);
  });

  it("the chosen idea keeps its radio when the offered ideas shrink or reorder", async () => {
    const mod = await import(ENTRY_URL.href);
    assert.equal(typeof mod.chosenIdeaIndex, "function", "the module exports chosenIdeaIndex");
    const [first, second, third] = IDEAS;
    assert.equal(mod.chosenIdeaIndex(IDEAS, null), null);
    assert.equal(mod.chosenIdeaIndex(IDEAS, committed(second)), 1);
    assert.equal(mod.chosenIdeaIndex([first, third], committed(third)), 1);
    assert.equal(mod.chosenIdeaIndex([third, first], committed(third)), 0);
    assert.equal(mod.chosenIdeaIndex([first, third], committed(first)), 0);
  });

  it("a chosen idea that is no longer offered marks no radio, and Tab reaches the first", async () => {
    const mod = await import(ENTRY_URL.href);
    assert.equal(typeof mod.chosenIdeaIndex, "function", "the module exports chosenIdeaIndex");
    const [first, second, third] = IDEAS;
    const gone = mod.chosenIdeaIndex([first, third], committed(second));
    assert.equal(gone, null);
    assert.equal(mod.tabbableIdeaIndex(gone, 2), 0);
    const otherRevision = { ...second, representationRevisionId: "idea-revision-second-later" };
    assert.equal(mod.chosenIdeaIndex([first, otherRevision, third], committed(second)), null);
  });

  it("a key that lands on the radio it was pressed on moves nothing", async () => {
    const ideaKeyMove = await theKeyMove();
    assert.equal(ideaKeyMove(0, 3, "Home", false), null);
    assert.equal(ideaKeyMove(2, 3, "End", false), null);
    for (const key of NAVIGATION_KEYS) {
      assert.equal(ideaKeyMove(0, 1, key, false), null, "one radio, " + key);
    }
  });

  it("a disabled step moves nothing on any key", async () => {
    const ideaKeyMove = await theKeyMove();
    for (const current of [0, 1, 2]) {
      for (const key of NAVIGATION_KEYS) {
        assert.equal(ideaKeyMove(current, 3, key, true), null, key + " from " + current);
      }
    }
  });

  it("a navigation key moves to the idea nextIdeaIndex names when it is another radio, and any other key moves nothing", async () => {
    const mod = await import(ENTRY_URL.href);
    const ideaKeyMove = await theKeyMove();
    for (const current of [0, 1, 2]) {
      for (const key of NAVIGATION_KEYS) {
        const named = mod.nextIdeaIndex(current, 3, key);
        assert.equal(ideaKeyMove(current, 3, key, false), named === current ? null : named, key + " from " + current);
      }
      for (const key of ["Tab", "Enter", " ", "Escape", "PageDown", "a"]) {
        assert.equal(ideaKeyMove(current, 3, key, false), null, JSON.stringify(key) + " from " + current);
      }
    }
    assert.equal(ideaKeyMove(1, 3, "ArrowDown", false), 2);
    assert.equal(ideaKeyMove(0, 3, "ArrowUp", false), 2);
    assert.equal(ideaKeyMove(2, 3, "Home", false), 0);
    assert.equal(ideaKeyMove(0, 3, "End", false), 2);
  });
});
