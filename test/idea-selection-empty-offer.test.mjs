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
 *   second write on a re-render or when the host hands down a new `onChange`;
 *   under React's StrictMode every write is that value;
 * - a list whose entries all lack a reference (nothing can be picked): the same
 *   one no-pick write;
 * - an empty offer on a read-only replay (`mode="view"`), while disabled, or
 *   both: no write at all;
 * - no list to read (no value, `ideas` missing, `ideas` not a list): no write,
 *   so the host keeps the Continue held, also when a list with ideas arrives
 *   after it;
 * - ideas on offer: no write before a pick, and a pick writes the reference of
 *   the chosen idea;
 * - a list that turns from empty to offering ideas: the no-pick answer is
 *   withdrawn by one blank write in both keys, and a pick then writes its
 *   reference.
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

const BLANK = { selectedIdeaJson: "", userResponse: "" };
const NO_PICK_WRITE = { selectedIdeaJson: NO_PICK, userResponse: NO_PICK };

/** Mount one reading; returns the recorded writes, the container and the root.
 *  A reading that names its own `onChange` is drawn with it (and records
 *  nothing here); `strict` draws the renderer inside React's StrictMode. */
async function mount(props, { strict = false } = {}) {
  const calls = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const draw = (next) => {
    const element = React.createElement(Renderer, {
      onChange: (value) => void calls.push(value),
      ...next,
    });
    return strict ? React.createElement(React.StrictMode, null, element) : element;
  };
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

  it("a new onChange identity from the host is not answered again", async () => {
    const first = [];
    const second = [];
    const view = await mount({ value: { ideas: [] }, onChange: (value) => void first.push(value) });
    try {
      await view.rerender({ value: { ideas: [] }, onChange: (value) => void second.push(value) });
      assert.deepEqual(first, [NO_PICK_WRITE], "the first onChange got the one answer");
      assert.deepEqual(second, [], "the second onChange got nothing");
    } finally {
      await view.unmount();
    }
  });

  it("under StrictMode every write of an empty offer is the no-pick value", async () => {
    const view = await mount({ value: { ideas: [] } }, { strict: true });
    try {
      assert.ok(view.calls.length >= 1, "the empty offer is answered");
      for (const call of view.calls) assert.deepEqual(call, NO_PICK_WRITE);
    } finally {
      await view.unmount();
    }
  });

  it("a list whose entries all lack a reference is answered with the no-pick value once", async () => {
    const view = await mount({
      value: {
        ideas: [
          { artifactId: "idea-artifact-only", title: "No revision" },
          { representationRevisionId: "idea-revision-only", title: "No artifact" },
          { artifactId: "", representationRevisionId: "idea-revision-blank", title: "Blank artifact" },
          "not an entry",
        ],
      },
    });
    try {
      assert.deepEqual(view.calls, [NO_PICK_WRITE]);
      assert.equal(view.container.querySelectorAll('[role="radio"]').length, 0, "no radio to pick");
    } finally {
      await view.unmount();
    }
  });

  it("an empty offer on a read-only replay that is also disabled writes nothing", async () => {
    const view = await mount({ value: { ideas: [] }, mode: "view", disabled: true });
    try {
      assert.deepEqual(view.calls, []);
    } finally {
      await view.unmount();
    }
  });

  for (const [name, props] of [
    ["no value", {}],
    ["a value without ideas", { value: { reason: "Some reason." } }],
    ["ideas that are not a list", { value: { ideas: { artifactId: "idea-artifact-first" } } }],
    ["ideas given as a JSON string", { value: { ideas: "[]" } }],
  ]) {
    it(`${name}: nothing is written, so the Continue stays held`, async () => {
      const view = await mount(props);
      try {
        assert.deepEqual(view.calls, []);
      } finally {
        await view.unmount();
      }
    });
  }

  it("no list to read, then a list with ideas: nothing is written before a pick", async () => {
    const view = await mount({});
    try {
      await view.rerender({ value: { ideas: IDEAS } });
      assert.deepEqual(view.calls, [], "nothing is picked for anyone");
    } finally {
      await view.unmount();
    }
  });

  it("an empty list that turns to offering ideas withdraws the no-pick answer, and a pick then writes", async () => {
    const view = await mount({ value: { ideas: [] } });
    try {
      assert.deepEqual(view.calls, [NO_PICK_WRITE]);
      await view.rerender({ value: { ideas: IDEAS } });
      assert.deepEqual(view.calls, [NO_PICK_WRITE, BLANK], "one blank write withdraws the answer");
      await view.rerender({ value: { ideas: IDEAS } });
      assert.equal(view.calls.length, 2, "a re-render writes nothing more");
      const radios = view.container.querySelectorAll('[role="radio"]');
      await act(async () => {
        radios[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
      const reference = JSON.stringify({
        artifactId: IDEAS[0].artifactId,
        representationRevisionId: IDEAS[0].representationRevisionId,
      });
      assert.deepEqual(view.calls[2], { selectedIdeaJson: reference, userResponse: reference });
      assert.equal(view.calls.length, 3);
    } finally {
      await view.unmount();
    }
  });
});
