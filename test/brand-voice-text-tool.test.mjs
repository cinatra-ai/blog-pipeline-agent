/**
 * THE BRAND VOICE AS TEXT: the tool this pack declares, and what it does.
 *
 * The host hands a step the picked brand voice as references to a stored
 * artifact, never its text (cinatra-ai/cinatra#4314). The read step in front of
 * the writing step calls the declared tool `brand_voice_text`, which reads the
 * one picked artifact through the content read the host binds to the run. These
 * cases pin the declaration the host resolves, the dependency the content read
 * is admitted by, and every road through the module: the text, an empty pick,
 * a PDF, an unreadable or unusable artifact, more than one pick, and every
 * binding the module cannot read. The same file runs in
 * blog-draft-writer-agent, blog-image-generator-agent and blog-pipeline-agent.
 *
 *   node --test test/brand-voice-text-tool.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const TOOL_NAME = "brand_voice_text";
const MODULE_PATH = "./cinatra/tools/brand-voice-text.mjs";
const BRAND_VOICE = "@cinatra-ai/brand-voice-artifact";
const REFUSAL_NAME = "ExtensionToolCallRefusal";

const PDF = "This brand voice is a PDF; pick a text brand voice.";
const UNREADABLE = "The chosen brand voice cannot be read; pick another brand voice.";
const TOO_LONG = "This brand voice is too long to read; pick a shorter brand voice.";
const EMPTY = "This brand voice has no text; pick another brand voice.";
const MORE_THAN_ONE = "More than one brand voice was picked; pick exactly one brand voice.";
const NO_BINDING = "The brand voice for this run did not reach this step; start the run again.";

/** Loaded per case, so a missing module fails each case rather than the file. */
async function tool() {
  const mod = await import(pathToFileURL(join(root, MODULE_PATH)).href);
  return mod.extensionTool;
}

const REF = { artifactId: "art-1", representationRevisionId: "rev-1", scope: "org" };
const binding = (refs) => [{ slotId: "brandVoice", refs }];

/** Ports with a content read that answers `answer` (a value, or a function that
 *  throws) and records each call. */
function portsWith(answer) {
  const calls = [];
  return {
    calls,
    ports: {
      artifacts: {
        async contentRead(request) {
          calls.push(request);
          return typeof answer === "function" ? answer(request) : answer;
        },
      },
    },
  };
}

const TEXT = { artifactId: "art-1", representationRevisionId: "rev-1", mime: "text/markdown", text: "Short, direct sentences.", truncated: false, bytesRead: 24, totalBytes: 24 };

async function refusalOf(input, answer = TEXT) {
  const extensionTool = await tool();
  const { calls, ports } = portsWith(answer);
  try {
    await extensionTool({ input, ports });
  } catch (e) {
    return { name: e?.name, message: e?.message, calls };
  }
  assert.fail(`no refusal for ${JSON.stringify(input)}`);
}

test("the manifest declares the tool as one { name, module } entry", () => {
  const tools = manifest.cinatra.tools;
  assert.ok(Array.isArray(tools), "cinatra.tools is an array");
  const entry = tools.find((t) => t && t.name === TOOL_NAME);
  assert.ok(entry, `the list declares "${TOOL_NAME}"`);
  assert.deepEqual(Object.keys(entry).sort(), ["module", "name"]);
  assert.equal(entry.module, MODULE_PATH);
  assert.match(entry.name, /^[a-z][a-z0-9_]*$/);
  assert.equal(tools.filter((t) => t && t.name === TOOL_NAME).length, 1, "declared once");
});

test("the manifest declares the brand-voice artifact, which the content read admits by", () => {
  const edges = (manifest.cinatra.dependencies ?? []).filter(
    (d) => d.kind === "artifact" && d.packageName === BRAND_VOICE,
  );
  assert.equal(edges.length, 1, "one artifact edge to the brand-voice artifact");
  assert.equal(edges[0].edgeType, "runtime");
  assert.equal(edges[0].requirement, "required");
});

test("the shipped files carry the module", () => {
  assert.ok((manifest.files ?? []).includes("cinatra"), "`files` ships cinatra/");
});

test("the one picked brand voice comes back as its text, from the JSON text a parent hands down", async () => {
  const extensionTool = await tool();
  const { calls, ports } = portsWith(TEXT);
  const out = await extensionTool({ input: { bindings: JSON.stringify(binding([REF])) }, ports });
  assert.deepEqual(out, { brandVoiceText: "Short, direct sentences." });
  assert.deepEqual(calls, [{ artifactId: "art-1", representationRevisionId: "rev-1" }]);
});

test("the list form of the bindings is read the same way", async () => {
  const extensionTool = await tool();
  const { calls, ports } = portsWith(TEXT);
  const out = await extensionTool({ input: { bindings: binding([REF]) }, ports });
  assert.deepEqual(out, { brandVoiceText: "Short, direct sentences." });
  assert.equal(calls.length, 1);
});

test("a ref without a revision reads the artifact's latest text", async () => {
  const extensionTool = await tool();
  const { calls, ports } = portsWith(TEXT);
  await extensionTool({ input: { bindings: binding([{ artifactId: "art-1" }]) }, ports });
  assert.deepEqual(calls, [{ artifactId: "art-1" }]);
});

test("a pick of nothing gives the empty text and reads nothing", async () => {
  const extensionTool = await tool();
  const { calls, ports } = portsWith(TEXT);
  const out = await extensionTool({ input: { bindings: JSON.stringify(binding([])) }, ports });
  assert.deepEqual(out, { brandVoiceText: "" });
  assert.equal(calls.length, 0);
});

test("a PDF brand voice stops the run with one sentence a person can act on", async () => {
  const r = await refusalOf({ bindings: binding([REF]) }, () => {
    const e = new Error("artifact_content_read: application/pdf is not a text representation");
    e.name = "ArtifactContentRefusal";
    e.reason = "not-text";
    throw e;
  });
  assert.equal(r.name, REFUSAL_NAME);
  assert.equal(r.message, PDF);
});

test("any other refusal of the content read stops the run, never runs without the voice", async () => {
  for (const reason of ["not-found", "no-representation", "revision-not-resolvable", "artifact-type-not-a-declared-dependency", undefined]) {
    const r = await refusalOf({ bindings: binding([REF]) }, () => {
      const e = new Error("refused");
      e.reason = reason;
      throw e;
    });
    assert.equal(r.name, REFUSAL_NAME, `reason ${reason}`);
    assert.equal(r.message, UNREADABLE, `reason ${reason}`);
  }
  const thrownString = await refusalOf({ bindings: binding([REF]) }, () => {
    throw "boom";
  });
  assert.equal(thrownString.message, UNREADABLE);
});

test("a read without text, a cut text or an empty text stops the run", async () => {
  assert.equal((await refusalOf({ bindings: binding([REF]) }, null)).message, UNREADABLE);
  assert.equal((await refusalOf({ bindings: binding([REF]) }, { ...TEXT, text: 42 })).message, UNREADABLE);
  assert.equal((await refusalOf({ bindings: binding([REF]) }, { ...TEXT, truncated: true })).message, TOO_LONG);
  assert.equal((await refusalOf({ bindings: binding([REF]) }, { ...TEXT, text: " \n\t" })).message, EMPTY);
});

test("more than one picked brand voice is refused before anything is read", async () => {
  const r = await refusalOf({ bindings: binding([REF, { ...REF, artifactId: "art-2" }]) });
  assert.equal(r.message, MORE_THAN_ONE);
  assert.equal(r.calls.length, 0);
});

test("a binding the module cannot read is refused, never read as no brand voice", async () => {
  const cases = [
    undefined,
    null,
    42,
    "",
    "   ",
    "not json",
    "{}",
    JSON.stringify({ slotId: "brandVoice", refs: [] }),
    [],
    [{ slotId: "draftContext", refs: [] }],
    [...binding([]), ...binding([])],
    [{ slotId: "brandVoice", refs: "art-1" }],
    [{ slotId: "brandVoice" }],
    binding([{ representationRevisionId: "rev-1" }]),
    binding([{ artifactId: "" }]),
    binding([{ artifactId: 7 }]),
    binding(["art-1"]),
  ];
  for (const bindings of cases) {
    const r = await refusalOf({ bindings });
    assert.equal(r.name, REFUSAL_NAME, JSON.stringify(bindings) ?? "undefined");
    assert.equal(r.message, NO_BINDING, JSON.stringify(bindings) ?? "undefined");
    assert.equal(r.calls.length, 0, "nothing is read");
  }
  const noInput = await refusalOf(undefined);
  assert.equal(noInput.message, NO_BINDING);
});

test("every sentence is one the host repeats as it stands", () => {
  // The bounds of cinatra's moduleRefusalSentenceIssue (src/lib/extension-tool-dispatch.ts),
  // re-stated: a sentence that breaks one is not repeated to the person at all.
  for (const s of [PDF, UNREADABLE, TOO_LONG, EMPTY, MORE_THAN_ONE, NO_BINDING]) {
    assert.ok(s.trim() !== "" && s.trim().length <= 400, s);
    assert.ok(!/[\r\n\u2028\u2029]/.test(s), s);
    assert.ok(!/\.(?:[cm]?js|tsx?|jsx):\d+(?::\d+)?/.test(s), s);
    assert.ok(!/\bfile:\//i.test(s) && !/\b[A-Za-z]:[\\/]/.test(s) && !/node_modules/.test(s), s);
    assert.ok(!/(?:^|[\s"'`(\[])(?:~|\.{1,2})?\/\S*\//.test(s), s);
    assert.ok(!/[A-Za-z0-9_-]{40,}/.test(s), s);
  }
});
