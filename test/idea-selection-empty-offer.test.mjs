/**
 * THE IDEA STEP, MOUNTED: WHAT IT WRITES, AND WHEN.
 *
 * The gate declares its pick `"x-required": true`, so the host holds the step's
 * Continue until this renderer writes a value for `selectedIdeaJson`. These arms
 * mount the renderer in a document (effects run, unlike the static markup the
 * other renderer tests read) and record every `onChange` call:
 *
 * - an empty offer, while the run waits: exactly one write, the no-pick value
 *   `{"noPick":true}` in both `selectedIdeaJson` and `userResponse`, and no
 *   second write on a re-render;
 * - an empty offer on a read-only replay (`mode="view"`) or while disabled: no
 *   write at all;
 * - ideas on offer: no write before a pick, and a pick writes the reference of
 *   the chosen idea.
 *
 *   node --test test/idea-selection-empty-offer.test.mjs
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const ENTRY_URL = new URL("../src/renderers/idea-selection.ts", import.meta.url);
const NO_PICK = JSON.stringify({ noPick: true });

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

let dom;
let React;
let act;
let createRoot;
let Renderer;

before(async () => {
  const { JSDOM } = await import("jsdom");
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  // react-dom reads the document from the globals when it loads, so they are set
  // before it is imported.
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  Renderer = (await import(ENTRY_URL.href)).default;
  assert.equal(typeof Renderer, "function", "the module's default export is a function");
});

after(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  dom?.window.close();
});

/** Mount one reading; returns the recorded writes, the container and the root. */
async function mount(props) {
  const calls = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const draw = (next) =>
    React.createElement(Renderer, { ...next, onChange: (value) => void calls.push(value) });
  await act(async () => {
    root.render(draw(props));
  });
  const rerender = async (next) => {
    await act(async () => {
      root.render(draw(next));
    });
  };
  const unmount = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  return { calls, container, rerender, unmount };
}

describe("the idea step, mounted", () => {
  it("an empty offer while the run waits writes the no-pick value exactly once", async () => {
    const view = await mount({ value: { ideas: [] } });
    try {
      assert.deepEqual(view.calls, [{ selectedIdeaJson: NO_PICK, userResponse: NO_PICK }]);
      await view.rerender({ value: { ideas: [] } });
      assert.equal(view.calls.length, 1, "a re-render writes nothing more");
    } finally {
      await view.unmount();
    }
  });

  it("the written value is the renderer's own exported no-pick value", async () => {
    const mod = await import(ENTRY_URL.href);
    assert.equal(mod.NO_PICK_JSON, NO_PICK);
  });

  it("an empty offer on a read-only replay writes nothing", async () => {
    const view = await mount({ value: { ideas: [] }, mode: "view" });
    try {
      assert.deepEqual(view.calls, []);
    } finally {
      await view.unmount();
    }
  });

  it("an empty offer while disabled writes nothing", async () => {
    const view = await mount({ value: { ideas: [] }, disabled: true });
    try {
      assert.deepEqual(view.calls, []);
    } finally {
      await view.unmount();
    }
  });

  it("with ideas on offer nothing is written before a pick, and a pick writes the chosen reference", async () => {
    const view = await mount({ value: { ideas: IDEAS } });
    try {
      assert.deepEqual(view.calls, [], "nothing is picked for anyone");
      const radios = view.container.querySelectorAll('[role="radio"]');
      assert.equal(radios.length, IDEAS.length, "one radio per offered idea");
      await act(async () => {
        radios[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
      const reference = JSON.stringify({
        artifactId: IDEAS[1].artifactId,
        representationRevisionId: IDEAS[1].representationRevisionId,
      });
      assert.deepEqual(view.calls, [{ selectedIdeaJson: reference, userResponse: reference }]);
    } finally {
      await view.unmount();
    }
  });
});
