/**
 * THE IDEA STEP, DRAWN BY THIS PACK'S OWN RENDERER.
 *
 * The one field-renderer binding this pack declares names its own module
 * (`component.entry`), so the runtime mounts this pack's renderer for the idea
 * step instead of a copy of its own. These arms read the static markup the
 * renderer draws for each reading of the step: the question the pipeline
 * declares with the pill 'Awaiting your pick' while the run waits, the
 * empty-state message the pipeline declares where no idea is on offer, and one
 * radio per offerable idea with none chosen. The declared words are read from
 * this pack's own manifest, never retyped here.
 *
 * Every module is loaded inside the arm that needs it, so a missing module or a
 * missing declaration fails that arm and not the whole file.
 *
 *   node --test test/idea-selection-renderer.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const BINDING_ID = "@cinatra-ai/blog-pipeline-agent:idea-selection";
const ENTRY = "./src/renderers/idea-selection.ts";
const ENTRY_URL = new URL("../src/renderers/idea-selection.ts", import.meta.url);

function theBinding() {
  const list = PKG.cinatra?.fieldRenderers;
  assert.ok(Array.isArray(list), "cinatra.fieldRenderers is a list");
  const found = list.filter((b) => b && b.id === BINDING_ID);
  assert.equal(found.length, 1, "exactly one binding carries the pack's idea-selection id");
  return found[0];
}

/** The declared words, as the manifest declares them. */
function declared() {
  const params = theBinding().params ?? {};
  return { question: params.question, emptyStateMessage: params.emptyStateMessage };
}

const WAITING_WORDS = "Awaiting your pick";
const FLOOR_SENTENCE = "No blog idea is on offer on this step, so there is nothing to pick here.";
const STATED_REASON =
  "There is no blog idea left to draft: every stored idea already has a draft or is reserved by another run. Generate new ideas, then start the pipeline again.";

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
const HELD_BACK = {
  artifactId: "idea-artifact-third",
  title: "An idea that names no revision",
  text: "An idea that names no revision\nIt is not offerable, so it draws no row.",
};

/** Load react, the static renderer and the pack's module, inside the arm. */
async function load() {
  const [{ createElement }, { renderToStaticMarkup }, mod] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import(ENTRY_URL.href),
  ]);
  const Renderer = mod.default;
  assert.equal(typeof Renderer, "function", "the module's default export is a function");
  /** Draw one reading; returns the markup and the calls the renderer made to onChange. */
  const draw = (props) => {
    const calls = [];
    const markup = renderToStaticMarkup(
      createElement(Renderer, { ...props, onChange: (next) => void calls.push(next) }),
    );
    return { markup, calls };
  };
  return { draw, Renderer };
}

function unescapeHtml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Every element whose opening tag's attributes match `attrPattern`, with its inner markup. */
function elementsWith(markup, attrPattern) {
  const out = [];
  const open = /<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>/g;
  let m;
  while ((m = open.exec(markup))) {
    const attrs = m[2] ?? "";
    if (!attrPattern.test(attrs)) continue;
    const tag = m[1];
    const tags = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, "g");
    tags.lastIndex = open.lastIndex;
    let depth = 1;
    let end = markup.length;
    let t;
    while ((t = tags.exec(markup))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index;
        break;
      }
    }
    out.push({ tag, attrs, inner: markup.slice(open.lastIndex, end), start: m.index });
  }
  return out;
}

const textOf = (el) => unescapeHtml(el.inner.replace(/<[^>]*>/g, ""));
const classesOf = (el) => (el.attrs.match(/\bclass="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);

const QUESTION = /\bdata-testid="idea-selection-gate-question"/;
const WAITING = /\bdata-testid="idea-selection-gate-waiting"/;
const HEADER = /\bdata-testid="idea-selection-gate-header"/;
const STATUS = /\brole="status"/;
const RADIO = /\brole="radio"/;
const RADIOGROUP = /\brole="radiogroup"/;

describe("the idea step drawn by the pack's own renderer (cinatra#3035)", () => {
  it("the one binding declares the pack's own renderer", async () => {
    const list = PKG.cinatra?.fieldRenderers;
    assert.ok(Array.isArray(list) && list.length === 1, "the pack declares one binding");
    const binding = theBinding();
    assert.equal(binding.component?.entry, ENTRY);
    assert.equal(binding.component?.propsApiVersion, 1);
    assert.ok(existsSync(ENTRY_URL), "the declared entry exists");
    const mod = await import(ENTRY_URL.href);
    assert.equal(typeof mod.default, "function", "the entry's default export is a function");
    // The binding itself is unchanged: its id, kind, priority, midRunHitl and
    // params, and nothing but the component beside them.
    assert.deepEqual(Object.keys(binding).sort(), [
      "component",
      "id",
      "kind",
      "midRunHitl",
      "params",
      "priority",
    ]);
    assert.equal(binding.kind, "blog-idea-selection");
    assert.equal(binding.priority, 80);
    assert.equal(binding.midRunHitl, true);
    assert.deepEqual(Object.keys(binding.params).sort(), ["emptyStateMessage", "question"]);
    assert.ok(typeof binding.params.question === "string" && binding.params.question.trim() !== "");
    assert.ok(
      typeof binding.params.emptyStateMessage === "string" &&
        binding.params.emptyStateMessage.trim() !== "",
    );
  });

  it("the declared question heads each of the four readings and the pill stands exactly while the run waits", async () => {
    const { draw } = await load();
    const words = declared();
    const readings = [
      { name: "the list, waiting", value: { ideas: IDEAS }, mode: undefined, waiting: true },
      { name: "the list, view", value: { ideas: IDEAS }, mode: "view", waiting: false },
      { name: "the empty offer, waiting", value: { ideas: [] }, mode: undefined, waiting: true },
      { name: "the empty offer, view", value: { ideas: [] }, mode: "view", waiting: false },
    ];
    for (const reading of readings) {
      const props = { value: reading.value, bindingParams: words };
      if (reading.mode !== undefined) props.mode = reading.mode;
      const { markup, calls } = draw(props);
      const questions = elementsWith(markup, QUESTION);
      assert.equal(questions.length, 1, reading.name);
      assert.equal(textOf(questions[0]), words.question, reading.name);
      const pills = elementsWith(markup, WAITING);
      assert.equal(pills.length, reading.waiting ? 1 : 0, reading.name);
      if (reading.waiting) assert.equal(textOf(pills[0]), WAITING_WORDS, reading.name);
      assert.equal(calls.length, 0, reading.name);
    }
  });

  it("the empty offer draws exactly the declared message over a stated reason, and nothing tells the reader to start the pipeline again", async () => {
    const { draw } = await load();
    const words = declared();
    const { markup, calls } = draw({
      value: { ideas: [], reason: STATED_REASON },
      bindingParams: words,
    });
    const statuses = elementsWith(markup, STATUS);
    assert.equal(statuses.length, 1);
    assert.equal(textOf(statuses[0]), words.emptyStateMessage);
    assert.doesNotMatch(unescapeHtml(markup), /start the pipeline again/i);
    assert.equal(elementsWith(markup, RADIO).length, 0);
    assert.equal(elementsWith(markup, RADIOGROUP).length, 0);
    assert.doesNotMatch(markup, /<(button|input|textarea|select)\b/);
    assert.equal(calls.length, 0);
  });

  it("the empty offer's sentence is drawn in the foreground ink, not the muted one", async () => {
    const { draw } = await load();
    const { markup, calls } = draw({ value: { ideas: [] }, bindingParams: declared() });
    const statuses = elementsWith(markup, STATUS);
    assert.equal(statuses.length, 1);
    const classes = classesOf(statuses[0]);
    assert.ok(classes.includes("text-foreground"), classes.join(" "));
    assert.ok(!classes.includes("text-muted-foreground"), classes.join(" "));
    assert.equal(calls.length, 0);
  });

  it("with no declaration the empty offer draws no question, still draws the pill, and reads the stated reason, else the floor sentence", async () => {
    const { draw } = await load();
    const readings = [
      { name: "a stated reason", value: { ideas: [], reason: STATED_REASON }, words: STATED_REASON },
      { name: "no reason", value: { ideas: [] }, words: FLOOR_SENTENCE },
    ];
    for (const reading of readings) {
      const { markup, calls } = draw({ value: reading.value });
      assert.equal(elementsWith(markup, QUESTION).length, 0, reading.name);
      const pills = elementsWith(markup, WAITING);
      assert.equal(pills.length, 1, reading.name);
      assert.equal(textOf(pills[0]), WAITING_WORDS, reading.name);
      const statuses = elementsWith(markup, STATUS);
      assert.equal(statuses.length, 1, reading.name);
      assert.equal(textOf(statuses[0]), reading.words, reading.name);
      assert.equal(calls.length, 0, reading.name);
    }
  });

  it("a blank declared question draws no question element, and the pill still stands while the run waits", async () => {
    const { draw } = await load();
    for (const value of [{ ideas: IDEAS }, { ideas: [] }]) {
      const { markup, calls } = draw({ value, bindingParams: { question: "   " } });
      assert.equal(elementsWith(markup, QUESTION).length, 0);
      const pills = elementsWith(markup, WAITING);
      assert.equal(pills.length, 1);
      assert.equal(textOf(pills[0]), WAITING_WORDS);
      assert.equal(calls.length, 0);
    }
  });

  it("the list draws one radio per offerable idea and none is chosen", async () => {
    const { draw } = await load();
    const { markup, calls } = draw({
      value: { ideas: [...IDEAS, HELD_BACK] },
      bindingParams: declared(),
    });
    const groups = elementsWith(markup, RADIOGROUP);
    assert.equal(groups.length, 1);
    assert.match(groups[0].attrs, /\baria-label="Select one blog idea to draft"/);
    const radios = elementsWith(markup, RADIO);
    assert.equal(radios.length, 2);
    for (const radio of radios) assert.match(radio.attrs, /\baria-checked="false"/);
    const text = unescapeHtml(markup.replace(/<[^>]*>/g, " "));
    assert.ok(text.includes("Select one blog idea to draft."));
    for (const idea of IDEAS) assert.ok(text.includes(idea.title), idea.title);
    assert.ok(!text.includes(HELD_BACK.title), "an idea naming no revision draws no row");
    const headers = elementsWith(markup, HEADER);
    assert.equal(headers.length, 1);
    assert.ok(headers[0].start < groups[0].start, "the header row stands before the radio group");
    assert.equal(calls.length, 0);
    // Each row carries what the host copy draws: the idea's body under its title.
    for (const idea of IDEAS) {
      const body = idea.text.split("\n").slice(1).join("\n").trim();
      assert.ok(text.includes(body), body);
    }
    // The offer's summary line, a positional title where none is declared, and
    // a disabled radio on a disabled step, still with none chosen.
    const SUMMARY = "Two ideas are waiting for a draft.";
    const second = draw({
      value: { summary: SUMMARY, ideas: [{ ...IDEAS[0], title: "  " }, IDEAS[1]] },
      bindingParams: declared(),
      disabled: true,
    });
    const secondText = unescapeHtml(second.markup.replace(/<[^>]*>/g, " "));
    assert.ok(secondText.includes(SUMMARY), "the summary line");
    assert.ok(secondText.includes("Idea 1"), "a blank title reads its position");
    assert.ok(!secondText.includes(IDEAS[0].title), "a blank title is not replaced by the text's first line");
    const secondRadios = elementsWith(second.markup, RADIO);
    assert.equal(secondRadios.length, 2);
    for (const radio of secondRadios) {
      assert.match(radio.attrs, /\bdisabled=""/);
      assert.match(radio.attrs, /\baria-checked="false"/);
    }
    assert.equal(second.calls.length, 0);
  });
});
