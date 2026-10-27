/**
 * THE BRAND VOICE AS TEXT: the tool this pack declares, and what it does.
 *
 * The host hands a step the picked brand voice as references to a stored
 * artifact, never its text (cinatra-ai/cinatra#4314). The read step in front of
 * the writing step calls the declared tool `brand_voice_text`, which reads the
 * one picked artifact through the content read the host binds to the run. These
 * cases pin the declaration the host resolves, the dependency the content read
 * is admitted by, and every road through the module: the text, an empty pick,
 * a PDF, an artifact that is not a brand voice, a brand voice past the one
 * page of the listing the module reads, an unreadable or unusable artifact, a
 * failure that is not the person's pick, more than one pick, and every binding
 * the module cannot read. The same file runs in
 * blog-draft-writer-agent, blog-image-generator-agent and blog-pipeline-agent.
 *
 *   node --test test/brand-voice-text-tool.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const TOOL_NAME = "brand_voice_text";
const MODULE_PATH = "./cinatra/tools/brand-voice-text.mjs";
const BRAND_VOICE = "@cinatra-ai/brand-voice-artifact";
const BLOG_IDEA = "@cinatra-ai/blog-idea-artifact";
const REFUSAL_NAME = "ExtensionToolCallRefusal";

const PDF = "This brand voice is a PDF; pick a text brand voice.";
const UNREADABLE = "The chosen brand voice cannot be read; pick another brand voice.";
const TOO_LONG = "This brand voice is too long to read; pick a shorter brand voice.";
const EMPTY = "This brand voice has no text; pick another brand voice.";
const MORE_THAN_ONE = "More than one brand voice was picked; pick exactly one brand voice.";
const NOT_A_BRAND_VOICE = "The chosen item is not a brand voice; pick a brand voice.";
const NO_BINDING = "The brand voice for this run did not reach this step; start the run again.";
const ALL_SENTENCES = [PDF, UNREADABLE, TOO_LONG, EMPTY, MORE_THAN_ONE, NOT_A_BRAND_VOICE, NO_BINDING];

/** The module, loaded per case. A module that is not shipped fails each case on
 *  an assertion, not on an import error. */
async function loaded() {
  try {
    return await import(pathToFileURL(join(root, MODULE_PATH)).href);
  } catch (e) {
    assert.fail(`${MODULE_PATH} does not load: ${e?.code ?? e?.name ?? "error"}`);
  }
}
async function tool() {
  return (await loaded()).extensionTool;
}

/** A ref as the host's context finalize hands it down. */
const REF = { artifactId: "art-1", representationRevisionId: "rev-1", extension: BRAND_VOICE, sourceScope: "organization" };
const binding = (refs) => [{ slotId: "brandVoice", refs }];

/** The host's own refusal of a content read, as its class names itself. */
function contentRefusal(reason) {
  const e = new Error(`artifact_content_read: refused (${reason})`);
  e.name = "ArtifactContentRefusal";
  e.reason = reason;
  return e;
}

const REF_LISTED = { artifactId: "art-1", artifactType: BRAND_VOICE };
const LISTED = { artifacts: [REF_LISTED] };

/** Ports with a content read that answers `answer` and a brand-voice listing
 *  that answers `listing` (each a value, or a function that throws), and that
 *  record each call. */
function portsWith(answer, listing = LISTED) {
  const calls = [];
  const lists = [];
  return {
    calls,
    lists,
    ports: {
      artifacts: {
        async list(request) {
          lists.push(request);
          return typeof listing === "function" ? listing(request) : listing;
        },
        async contentRead(request) {
          calls.push(request);
          return typeof answer === "function" ? answer(request) : answer;
        },
      },
    },
  };
}

const TEXT = { artifactId: "art-1", representationRevisionId: "rev-1", mime: "text/markdown", text: "Short, direct sentences.", truncated: false, bytesRead: 24, totalBytes: 24 };

/** Every sentence a case below saw the module stop a run with. */
const seenSentences = new Set();

async function refusalOf(input, answer = TEXT, listing = LISTED) {
  const extensionTool = await tool();
  const { calls, lists, ports } = portsWith(answer, listing);
  try {
    await extensionTool({ input, ports });
  } catch (e) {
    if (e?.name === REFUSAL_NAME) seenSentences.add(e.message);
    return { error: e, name: e?.name, message: e?.message, calls, lists };
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
  assert.ok(existsSync(join(root, MODULE_PATH)), `${MODULE_PATH} is in the package`);
});

test("the one picked brand voice comes back as its text, from the JSON text a parent hands down", async () => {
  const extensionTool = await tool();
  const { calls, lists, ports } = portsWith(TEXT);
  const out = await extensionTool({ input: { bindings: JSON.stringify(binding([REF])) }, ports });
  assert.deepEqual(out, { brandVoiceText: "Short, direct sentences." });
  assert.deepEqual(calls, [{ artifactId: "art-1", representationRevisionId: "rev-1" }]);
  assert.deepEqual(lists, [{ types: [BRAND_VOICE], limit: 500 }], "the brand-voice listing is asked first");
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
  await extensionTool({ input: { bindings: binding([{ artifactId: "art-1", extension: BRAND_VOICE }]) }, ports });
  assert.deepEqual(calls, [{ artifactId: "art-1" }]);
});

test("a pick of nothing gives the empty text and reads nothing", async () => {
  const extensionTool = await tool();
  const { calls, lists, ports } = portsWith(TEXT);
  const out = await extensionTool({ input: { bindings: JSON.stringify(binding([])) }, ports });
  assert.deepEqual(out, { brandVoiceText: "" });
  assert.equal(calls.length, 0);
  assert.equal(lists.length, 0);
});

/** A first page of the listing that offers a next page: any key of it other
 *  than `artifacts` answers a token for the next page, as the host's page does
 *  under its own key. Each such key a module reads is recorded. */
function pageOfferingMore(artifacts) {
  const keysRead = [];
  const page = new Proxy(
    { artifacts },
    {
      get(target, key, receiver) {
        if (typeof key !== "string" || key === "artifacts" || key === "then") return Reflect.get(target, key, receiver);
        keysRead.push(key);
        return "next-page-token";
      },
      has(target, key) {
        if (typeof key === "string" && key !== "artifacts") keysRead.push(key);
        return typeof key === "string" || Reflect.has(target, key);
      },
    },
  );
  return { page, keysRead };
}

test("the listing is read once, its first page only, and a brand voice past it is refused at item 501", async () => {
  // 500 newer brand voices fill the first page, and that page offers a next
  // page, which holds the pick: the pick is item 501.
  const firstPage = Array.from({ length: 500 }, (_, i) => ({ artifactId: `art-newer-${i}`, artifactType: BRAND_VOICE }));
  const offered = pageOfferingMore(firstPage);
  const pages = [offered.page, LISTED];
  const extensionTool = await tool();
  const asked = portsWith(TEXT, () => pages.shift());
  let error;
  try {
    await extensionTool({ input: { bindings: binding([REF]) }, ports: asked.ports });
  } catch (e) {
    error = e;
  }
  // The paging pin comes first, so a module that asks for the next page fails here.
  assert.deepEqual(asked.lists, [{ types: [BRAND_VOICE], limit: 500 }], "one request, for the first page only: the next page is never asked for");
  assert.deepEqual(offered.keysRead, [], "nothing but its artifacts is read from the first page");
  assert.equal(error?.name, REFUSAL_NAME, "the pick past the first page is refused");
  seenSentences.add(error.message);
  assert.equal(error.message, UNREADABLE, "the sentence asks for another brand voice");
  assert.equal(asked.calls.length, 0, "nothing is read");
  // the same pick as item 500 is on the first page, and is read
  const item500 = [pageOfferingMore([...firstPage.slice(1), REF_LISTED]).page, { artifacts: [] }];
  const { calls, lists, ports } = portsWith(TEXT, () => item500.shift());
  const out = await extensionTool({ input: { bindings: binding([REF]) }, ports });
  assert.deepEqual(out, { brandVoiceText: "Short, direct sentences." });
  assert.equal(lists.length, 1);
  assert.equal(calls.length, 1);
});

test("an artifact that is not a brand voice stops the run, and its text is never read", async () => {
  const cases = [
    // a ref that names another artifact type the pack also declares
    { refs: [{ ...REF, extension: BLOG_IDEA }], listing: LISTED },
    // a ref that names no type
    { refs: [{ artifactId: "art-1", representationRevisionId: "rev-1" }], listing: LISTED },
    // the listing holds the id under another type
    { refs: [REF], listing: { artifacts: [{ artifactId: "art-1", artifactType: BLOG_IDEA }] } },
  ];
  for (const { refs, listing } of cases) {
    const r = await refusalOf({ bindings: binding(refs) }, TEXT, listing);
    assert.equal(r.name, REFUSAL_NAME, JSON.stringify(refs));
    assert.equal(r.message, NOT_A_BRAND_VOICE, JSON.stringify(refs));
    assert.equal(r.calls.length, 0, "nothing is read");
  }
});

test("a pick the brand-voice listing does not hold stops the run, and its text is never read", async () => {
  const listings = [
    // a ref that claims the brand-voice type for an artifact the listing does not hold
    { artifacts: [{ artifactId: "art-2", artifactType: BRAND_VOICE }] },
    // an empty listing
    { artifacts: [] },
    // a listing without a list
    {},
    null,
  ];
  for (const listing of listings) {
    const r = await refusalOf({ bindings: binding([REF]) }, TEXT, listing);
    assert.equal(r.name, REFUSAL_NAME, JSON.stringify(listing));
    assert.equal(r.message, UNREADABLE, JSON.stringify(listing));
    assert.equal(r.lists.length, 1);
    assert.equal(r.calls.length, 0, "nothing is read");
  }
});

test("a PDF brand voice stops the run with one sentence a person can act on", async () => {
  const r = await refusalOf({ bindings: binding([REF]) }, () => {
    throw contentRefusal("not-text");
  });
  assert.equal(r.name, REFUSAL_NAME);
  assert.equal(r.message, PDF);
});

test("any other refusal of the content read stops the run, never runs without the voice", async () => {
  for (const reason of ["not-found", "no-representation", "revision-not-resolvable", "invalid-request", undefined]) {
    const r = await refusalOf({ bindings: binding([REF]) }, () => {
      throw contentRefusal(reason);
    });
    assert.equal(r.name, REFUSAL_NAME, `reason ${reason}`);
    assert.equal(r.message, UNREADABLE, `reason ${reason}`);
  }
});

test("a failure that is not the content read's refusal is thrown on as it is, never as the person's pick", async () => {
  const storeFault = new Error("connection reset");
  const lookalike = Object.assign(new Error("not a content refusal"), { reason: "not-text" });
  const admission = Object.assign(new Error("artifact type not declared"), { name: "ArtifactAdmissionRefusal" });
  for (const thrown of [storeFault, lookalike, admission, "boom"]) {
    const r = await refusalOf({ bindings: binding([REF]) }, () => {
      throw thrown;
    });
    assert.equal(r.error, thrown, "the same value is thrown on");
    assert.notEqual(r.name, REFUSAL_NAME);
  }
  const listFault = new Error("listing failed");
  const r = await refusalOf({ bindings: binding([REF]) }, TEXT, () => {
    throw listFault;
  });
  assert.equal(r.error, listFault, "a failed listing is thrown on as it is");
  assert.equal(r.calls.length, 0);
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
  assert.equal(r.lists.length, 0);
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
    // the brand-voice binding with anything else beside it
    [...binding([REF]), { slotId: "draftContext", refs: [] }],
    [{ slotId: "draftContext", refs: [] }, ...binding([REF])],
    [...binding([REF]), "junk"],
    [{ slotId: "brandVoice", refs: "art-1" }],
    [{ slotId: "brandVoice" }],
    binding([{ representationRevisionId: "rev-1", extension: BRAND_VOICE }]),
    binding([{ artifactId: "", extension: BRAND_VOICE }]),
    binding([{ artifactId: "  ", extension: BRAND_VOICE }]),
    binding([{ artifactId: 7, extension: BRAND_VOICE }]),
    // a revision that is there but names nothing
    binding([{ ...REF, representationRevisionId: "" }]),
    binding([{ ...REF, representationRevisionId: "  " }]),
    binding([{ ...REF, representationRevisionId: 7 }]),
    binding([{ ...REF, representationRevisionId: null }]),
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

/** The host's bounds on a repeated sentence: cinatra's `moduleRefusalSentenceIssue`
 *  (src/lib/extension-tool-dispatch.ts), re-stated whole, the secret shapes
 *  included. A sentence that breaks one is not repeated to the person at all. */
function hostSentenceIssue(sentence) {
  if (typeof sentence !== "string") return "the sentence is not a string";
  const text = sentence.trim();
  if (text === "") return "the sentence is empty";
  if (text.length > 400) return "the sentence is longer than 400 characters";
  if (/[\r\n\u2028\u2029]/.test(text)) return "the sentence holds a line break";
  if (/\.(?:[cm]?js|tsx?|jsx):\d+(?::\d+)?/.test(text)) return "the sentence holds a source position";
  if (
    /\bfile:\//i.test(text) ||
    /\b[A-Za-z]:[\\/]/.test(text) ||
    /node_modules/.test(text) ||
    /(?:^|[\s"'`(\[])(?:~|\.{1,2})?\/\S*\//.test(text)
  ) {
    return "the sentence holds a path";
  }
  if (
    /sk-ant-[A-Za-z0-9_-]+/.test(text) ||
    /sk-[A-Za-z0-9_-]{16,}/.test(text) ||
    /\b(?:AIza|ya29\.)[A-Za-z0-9_.-]+/.test(text) ||
    /(?:authorization|x-api-key|api[_-]?key|bearer)\s*[:=]\s*\S+/i.test(text) ||
    /\bbearer\s+(?=[A-Za-z0-9._~+/-]*(?:\d|[A-Za-z0-9]\.[A-Za-z0-9]))[A-Za-z0-9._~+/-]{8,}/i.test(text) ||
    /[A-Za-z0-9_-]{40,}/.test(text)
  ) {
    return "the sentence holds a secret shape";
  }
  return null;
}

test("the module names every sentence it can stop a run with", async () => {
  const { REFUSAL_SENTENCES } = await loaded();
  assert.ok(Array.isArray(REFUSAL_SENTENCES), "the module exports REFUSAL_SENTENCES");
  assert.deepEqual([...REFUSAL_SENTENCES].sort(), [...ALL_SENTENCES].sort());
});

test("every sentence the module can stop a run with is one the host repeats as it stands", async () => {
  const { REFUSAL_SENTENCES } = await loaded();
  assert.ok(Array.isArray(REFUSAL_SENTENCES), "the module exports REFUSAL_SENTENCES");
  for (const s of REFUSAL_SENTENCES) assert.equal(hostSentenceIssue(s), null, s);
  // and every sentence a case above saw is one of them
  for (const s of seenSentences) assert.ok(REFUSAL_SENTENCES.includes(s), s);
});
