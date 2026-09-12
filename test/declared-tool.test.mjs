/**
 * THE TOOL THIS PACK DECLARES, pinned against the rules the host states.
 *
 * The stored-ideas gate no longer travels through a tool of the host's own: the
 * host admits ONE generic dispatch on its passthrough, and the name it dispatches
 * is resolved against the CALLING pack's own manifest. So the declaration is this
 * pack's, and the rules it must satisfy are the host's:
 *
 *   - the list lives at `cinatra.tools`, and each entry is `{ name, module }`
 *     and nothing else;
 *   - `name` is in the same local-identifier vocabulary a declared table's name
 *     uses, and is unique within the list;
 *   - `module` is PACKAGE-RELATIVE and inside this pack's own tree: it starts
 *     `./`, uses forward slashes, carries no parent-directory segment, is never
 *     absolute, and names a BUILT artifact (`.mjs`, `.cjs` or `.js`) — never a
 *     source mirror such as `.ts`;
 *   - the module's callable export is the named export `extensionTool`, one
 *     function of one argument shaped `{ input, ports }`.
 *
 * Those rules are RE-STATED here as the host's own cases state them, so this pack
 * is checked by the same rules rather than by a copy of the host's parser: a
 * declaration that would be refused at the seam is refused here first.
 *
 *   node --test test/declared-tool.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** The gate's own name, as the flow's three steps ask the dispatch for it. */
const TOOL_NAME = "stored_ideas";
/** The one export the host calls on a declared module, and nothing else. */
const MODULE_EXPORT = "extensionTool";
/** The local-identifier vocabulary a declared name lives in. */
const LOCAL_IDENT_RE = /^[a-z][a-z0-9_]*$/;
/** The built-artifact extensions a declared module may carry. */
const IMPORTABLE_MODULE_RE = /\.(mjs|cjs|js)$/;

/** Why one declared module path would be refused, or null when it is admitted —
 *  the rule the host applies at the declaration gate and again at the load gate. */
function declaredToolModulePathIssue(modulePath) {
  if (typeof modulePath !== "string" || modulePath.trim() === "") {
    return "module must be a non-empty package-relative path";
  }
  const raw = modulePath.trim();
  if (raw.includes("\\")) return "module must use forward slashes";
  if (!raw.startsWith("./")) return 'module must be package-relative and start with "./"';
  const rel = raw.slice(2);
  if (rel === "") return "module must name a file inside the package";
  const segments = rel.split("/");
  if (segments.some((seg) => seg === "..")) {
    return "module must stay inside the package's own tree — no parent-directory segment";
  }
  if (segments.some((seg) => seg === "")) return "module must not carry an empty path segment";
  if (!IMPORTABLE_MODULE_RE.test(rel)) {
    return "module must name a BUILT artifact (.mjs, .cjs or .js)";
  }
  return null;
}

test("the manifest declares the gate's tool as one { name, module } entry and nothing else", () => {
  const tools = manifest.cinatra.tools;
  assert.ok(Array.isArray(tools), "cinatra.tools is an array — a map or a bare name is refused");
  const entry = tools.find((t) => t && t.name === TOOL_NAME);
  assert.ok(entry, `the list declares the gate's tool "${TOOL_NAME}"`);
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["module", "name"],
    "an entry carries the two fields the host reads, and no field it does not",
  );
  const names = tools.map((t) => t.name);
  assert.equal(
    new Set(names).size,
    names.length,
    "one name resolves to one module — a name declared twice is refused",
  );
});

test("the declared name is in the vocabulary the host resolves a name in", () => {
  const entry = manifest.cinatra.tools.find((t) => t.name === TOOL_NAME);
  assert.match(entry.name, LOCAL_IDENT_RE);
});

test("the declared module is package-relative, inside this pack's tree, and a built artifact", () => {
  const entry = manifest.cinatra.tools.find((t) => t.name === TOOL_NAME);
  assert.equal(
    declaredToolModulePathIssue(entry.module),
    null,
    `the declared module path "${entry.module}" is admitted by the host's own rule`,
  );
});

test("the rules this pack is checked by are the host's, refusal by refusal", () => {
  // The same cases the host's declared-tools contract states. Without them the
  // check above could pass against a rule this pack invented.
  assert.equal(declaredToolModulePathIssue("./cinatra/tools/stored-ideas.mjs"), null);
  assert.equal(declaredToolModulePathIssue("./register.cjs"), null);
  assert.equal(declaredToolModulePathIssue("./dist/tool.js"), null);
  assert.match(declaredToolModulePathIssue("./../outside.mjs"), /parent-directory segment/);
  assert.match(declaredToolModulePathIssue("./cinatra/../../outside.mjs"), /parent-directory segment/);
  assert.match(declaredToolModulePathIssue("/etc/passwd.mjs"), /package-relative/);
  assert.match(declaredToolModulePathIssue("C:/windows/tool.mjs"), /package-relative/);
  assert.match(declaredToolModulePathIssue("cinatra/tools/stored-ideas.mjs"), /package-relative/);
  assert.match(declaredToolModulePathIssue(".\\cinatra\\tools\\stored-ideas.mjs"), /forward slashes/);
  assert.match(declaredToolModulePathIssue("./src/lib/blog/stored-ideas-gate-runner.ts"), /BUILT artifact/);
  assert.match(declaredToolModulePathIssue("./tool"), /BUILT artifact/);
  assert.match(declaredToolModulePathIssue(undefined), /non-empty package-relative path/);
  assert.match(declaredToolModulePathIssue("   "), /non-empty package-relative path/);
});

test("the declared module ships in the published package, so the pinned lock can load it", () => {
  // The host loads the declared module from the MATERIALIZED package at the
  // pinned version: a module the package does not ship is a declaration the seam
  // cannot honour. The `files` allowlist is what ships.
  const entry = manifest.cinatra.tools.find((t) => t.name === TOOL_NAME);
  const rel = entry.module.slice(2);
  const shipped = manifest.files ?? [];
  assert.ok(
    shipped.some((f) => rel === f || rel.startsWith(`${f}/`)),
    `the package ships "${rel}" (files: ${JSON.stringify(shipped)})`,
  );
});
