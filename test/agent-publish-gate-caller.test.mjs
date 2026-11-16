// THE PACK CHECK RUNS ON EVERY CHANGE (cinatra-ai/cinatra#4150): the shared
// agent pack publish gate lives in cinatra-ai/ci as a reusable workflow, and
// this pack calls it from its own caller. This file pins that caller by its
// STRUCTURE, not by lines that look right: it reads the workflow as the small
// block-mapping form it is written in, refuses everything else, and then
// requires exactly this shape (the reader takes only line feeds and printable
// ASCII, so nothing can hide in a comment or a value):
//
//   on            pull_request with no filter, and push with branches [main]
//   permissions   contents: read, nothing else
//   jobs          ONE job, whose only keys are `uses` and `with`
//   uses          the shared gate at one 40-hex commit
//   with          package "." and ref, the SAME commit (so the gate code never
//                 comes from a moving branch)
//
// A job with only `uses` and `with` has no `if`, no `needs` and passes no
// secrets, so nothing in the file can skip the call or widen it. The cases
// under "refused" change the committed caller one way each and must each be
// refused: a line that only looks like the call (inside a run block, at step
// level, under another key), a condition, a filter, a second job, a moving
// ref, a duplicate key.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import { test } from "node:test";

const CALLER = ".github/workflows/agent-publish-gate.yml";
const GATE = "cinatra-ai/ci/.github/workflows/agent-publish-gate.yml";
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const USES = new RegExp(`^${escapeRegExp(GATE)}@([0-9a-f]{40})$`);

const callerPath = fileURLToPath(new URL(`../${CALLER}`, import.meta.url));
const text = () => readFileSync(callerPath, "utf8");

// One value of the subset: nothing (the key opens a mapping or is empty), a
// quoted string, a flow list of plain words, or one plain word (it starts with
// a letter, a digit, "_", "." or "/"). A trailing
// comment is dropped. Everything else (a block scalar, an inline mapping, an
// anchor, a tag, a value with spaces) is refused. Only the space is white space.
function readValue(rest, n) {
  if (rest === "" || rest.startsWith("#")) return null;
  let m = /^"([^"\\]*)"(?: +#.*)?$/.exec(rest) || /^'([^']*)'(?: +#.*)?$/.exec(rest);
  if (m) return m[1];
  m = /^\[ *([A-Za-z0-9_.\/-]+(?: *, *[A-Za-z0-9_.\/-]+)*) *\](?: +#.*)?$/.exec(rest);
  if (m) return m[1].split(",").map((word) => word.trim());
  m = /^([A-Za-z0-9_.\/][A-Za-z0-9_.\/@-]*)(?: +#.*)?$/.exec(rest);
  if (m) return m[1];
  throw new Error(`line ${n} holds a value this reader does not take`);
}

// Reads nested `key:` / `key: value` lines, two spaces a level. Before any
// line is read it refuses every character other than a line feed and printable
// ASCII (U+0020 to U+007E): a tab, a carriage return, a control character, a
// byte order mark, a no-break space, a line separator. A YAML parser rejects
// some of these and reads others as a line break or as part of a value, so no
// comment and no value may hold them. It also refuses a line of any other form (a list item, a block scalar's
// text, a document mark), an indentation that opens no mapping, and a key
// written twice in one mapping.
function readMappings(source) {
  const odd = /[^\n\x20-\x7E]/u.exec(source);
  if (odd) {
    const point = odd[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
    throw new Error(`the file holds U+${point}; only line feeds and printable ASCII are read`);
  }
  const root = Object.create(null); // no inherited key: "__proto__" is a key like any other
  const open = [{ indent: 0, map: root }];
  let empty = null; // the last line, when it was a key with no value
  source.split("\n").forEach((raw, index) => {
    const n = index + 1;
    const line = raw.replace(/ +$/, "");
    if (line === "" || /^ *#/.test(line)) return;
    const m = /^( *)([A-Za-z_][A-Za-z0-9_-]*):(?: +(.*))?$/.exec(line);
    if (!m) throw new Error(`line ${n} is not "key:" or "key: value"`);
    const indent = m[1].length;
    const key = m[2];
    if (empty && indent === empty.indent + 2) {
      const child = Object.create(null);
      empty.map[empty.key] = child;
      open.push({ indent, map: child });
    } else {
      while (open.length > 1 && open[open.length - 1].indent > indent) open.pop();
    }
    empty = null;
    const top = open[open.length - 1];
    if (top.indent !== indent) throw new Error(`line ${n} is indented under no open mapping`);
    if (Object.prototype.hasOwnProperty.call(top.map, key)) throw new Error(`line ${n} writes the key ${key} twice`);
    const value = readValue(m[3] === undefined ? "" : m[3], n);
    top.map[key] = value;
    if (value === null) empty = { indent, map: top.map, key };
  });
  return root;
}

const isMapping = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysOf = (value) => (isMapping(value) ? Object.keys(value).sort().join(",") : "no mapping");

// Every reason the source is not the one caller this pack may have. An empty
// list means: the workflow is exactly the call of the shared gate.
function callerFaults(source) {
  let doc;
  try {
    doc = readMappings(source);
  } catch (error) {
    return [error.message];
  }
  const faults = [];
  if (keysOf(doc) !== "jobs,name,on,permissions") faults.push(`the top-level keys are ${keysOf(doc)}`);
  if (typeof doc.name !== "string") faults.push("name is not one word");
  if (keysOf(doc.on) !== "pull_request,push") {
    faults.push(`the triggers are ${keysOf(doc.on)}, not pull_request and push`);
  } else {
    if (doc.on.pull_request !== null) faults.push("pull_request carries a filter");
    const push = doc.on.push;
    if (keysOf(push) !== "branches" || !Array.isArray(push.branches) || push.branches.join(",") !== "main") {
      faults.push("push is not exactly branches: [main]");
    }
  }
  if (keysOf(doc.permissions) !== "contents" || doc.permissions.contents !== "read") {
    faults.push("permissions is not exactly contents: read");
  }
  const names = isMapping(doc.jobs) ? Object.keys(doc.jobs) : [];
  if (names.length !== 1) {
    faults.push(`jobs holds ${names.length} jobs, not one`);
    return faults;
  }
  const job = doc.jobs[names[0]];
  if (keysOf(job) !== "uses,with") {
    faults.push(`the job's keys are ${keysOf(job)}, not uses and with`);
    return faults;
  }
  const pin = typeof job.uses === "string" ? USES.exec(job.uses) : null;
  if (!pin) faults.push("uses is not the shared gate at a 40-hex commit");
  if (keysOf(job.with) !== "package,ref") {
    faults.push(`with holds ${keysOf(job.with)}, not package and ref`);
  } else {
    if (job.with.package !== ".") faults.push("with.package is not this package");
    if (!pin || job.with.ref !== pin[1]) faults.push("with.ref is not the commit uses pins");
  }
  return faults;
}

// ---- the committed caller ---------------------------------------------------

test("the pack has a caller of the shared publish gate", () => {
  assert.equal(existsSync(callerPath), true, CALLER);
});

test("the caller is exactly the call of the shared gate: on every pull request and every push to main, pinned, this package", () => {
  assert.deepEqual(callerFaults(text()), []);
});

// ---- fixtures: the committed caller, changed one way each ---------------------

const PIN = () => {
  const m = /@([0-9a-f]{40})/.exec(text());
  if (!m) throw new Error("the committed caller pins no commit");
  return m[1];
};
// swap(from, to) changes the ONE place `from` matches; a fixture that matches
// nothing, or more than one place, is a broken fixture and fails its case.
const swap = (from, to) => (source) => {
  const hits = source.match(new RegExp(from.source, "gm")) || [];
  if (hits.length !== 1) throw new Error(`the fixture matches ${hits.length} places, not one: ${from}`);
  return source.replace(new RegExp(from.source, "m"), to);
};
const then = (...steps) => (source) => steps.reduce((value, step) => step(value), source);
const USES_LINE = /^    uses: .*$/;
const REF_LINE = /^      ref: .*\n/;
const JOBS = /^jobs:\n[\s\S]*$/;
const jobsAre = (lines) => (source) => swap(JOBS, ["jobs:", ...lines, ""].join("\n"))(source);

const KEPT = [
  ["the values quoted the other way", then(swap(/^      package: .*$/, "      package: '.'"), (s) => swap(REF_LINE, `      ref: "${PIN()}"\n`)(s))],
  ["more comments and blank lines", then(swap(/^on:$/, "# when\n\non:"), swap(/^    with:$/, "    with: # the inputs"))],
  ["another job name", swap(/^  agent-publish-gate:$/, "  gate:")],
  ["with before uses", (s) => jobsAre(["  agent-publish-gate:", "    with:", '      package: "."', `      ref: ${PIN()}`, `    uses: ${GATE}@${PIN()} # v0`])(s)],
];
for (const [name, change] of KEPT) {
  test(`kept: ${name}`, () => {
    const base = text();
    const changed = change(base);
    assert.equal(changed !== base, true, "the fixture changes the caller");
    assert.deepEqual(callerFaults(changed), []);
  });
}

const REFUSED = [
  ["the call's lines sit in a run block of an ordinary job", (s) => jobsAre(["  agent-publish-gate:", "    runs-on: ubuntu-latest", "    steps:", "      - run: |", `          uses: ${GATE}@${PIN()}`, '          package: "."', `          ref: ${PIN()}`])(s)],
  ["the call sits at step level", (s) => jobsAre(["  agent-publish-gate:", "    runs-on: ubuntu-latest", "    steps:", `      - uses: ${GATE}@${PIN()}`, "        with:", '          package: "."', `          ref: ${PIN()}`])(s)],
  ["the job has an if", swap(USES_LINE, "    if: false\n$&")],
  ["the job needs another job", swap(USES_LINE, "    needs: other\n$&")],
  ["the job passes every secret", swap(USES_LINE, "$&\n    secrets: inherit")],
  ["the job holds a key named __proto__", swap(USES_LINE, "    __proto__: x\n$&")],
  ["a second job", (s) => `${s.replace(/\n*$/, "\n")}  other:\n    runs-on: ubuntu-latest\n`],
  ["uses written twice in the job", swap(USES_LINE, "$&\n$&")],
  ["ref written twice in with", swap(REF_LINE, "$&      ref: main\n")],
  ["ref stands under a top-level env, not in with", then(swap(REF_LINE, ""), (s) => swap(/^jobs:$/, `env:\n  ref: ${PIN()}\n\njobs:`)(s))],
  ["no ref in with (the gate would check out its default branch)", swap(REF_LINE, "")],
  ["ref is another commit than uses pins", swap(REF_LINE, `      ref: ${"0".repeat(40)}\n`)],
  ["ref is a branch", swap(REF_LINE, "      ref: main\n")],
  ["uses names a branch", (s) => swap(USES_LINE, `    uses: ${GATE}@main`)(s)],
  ["uses names a short commit", (s) => swap(USES_LINE, `    uses: ${GATE}@${PIN().slice(0, 12)}`)(s)],
  ["uses names another workflow of the shared repository", (s) => swap(USES_LINE, `    uses: cinatra-ai/ci/.github/workflows/actions-pinned-gate.yml@${PIN()}`)(s)],
  ["uses names the gate in another repository", (s) => swap(USES_LINE, `    uses: someone/ci/.github/workflows/agent-publish-gate.yml@${PIN()}`)(s)],
  ["another package", swap(/^      package: .*$/, '      package: "packages/other"')],
  ["with as an inline mapping", (s) => jobsAre(["  agent-publish-gate:", `    uses: ${GATE}@${PIN()}`, `    with: { package: ".", ref: ${PIN()} }`])(s)],
  ["with holds a third input", swap(REF_LINE, "$&      format: json\n")],
  ["pull_request with a paths filter", swap(/^  pull_request:$/, "  pull_request:\n    paths: [docs]")],
  ["pull_request with a types filter", swap(/^  pull_request:$/, "  pull_request:\n    types: [closed]")],
  ["pull_request with a block list filter", swap(/^  pull_request:$/, "  pull_request:\n    branches:\n      - release")],
  ["no pull_request trigger", swap(/^  pull_request:\n/, "")],
  ["pull_request commented out", swap(/^  pull_request:$/, "  # pull_request:")],
  ["pull_request_target instead of pull_request", swap(/^  pull_request:$/, "  pull_request_target:")],
  ["push on another branch", swap(/^    branches: .*$/, "    branches: [release]")],
  ["push with a paths filter", swap(/^    branches: .*$/, "$&\n    paths: [docs]")],
  ["push with no branches", swap(/^    branches: .*\n/, "")],
  ["no push trigger", swap(/^  push:\n    branches: .*\n/, "")],
  ["a third trigger", swap(/^  pull_request:$/, "  workflow_dispatch:\n$&")],
  ["on written twice", (s) => `${s.replace(/\n*$/, "\n")}on:\n  workflow_dispatch:\n`],
  ["the triggers in an inline list", swap(/^on:\n  pull_request:\n  push:\n    branches: .*$/, "on: [pull_request, push]")],
  ["permissions widened to write", swap(/^  contents: read$/, "  contents: write")],
  ["a second permission", swap(/^  contents: read$/, "$&\n  id-token: write")],
  ["no permissions", swap(/^permissions:\n  contents: read\n/, "")],
  ["a tab before uses", swap(USES_LINE, (line) => line.replace(/^ {4}/, "\t"))],
  ["uses indented by three spaces", swap(USES_LINE, (line) => line.replace(/^ {4}/, "   "))],
  ["with's inputs indented like the job's keys", then(swap(/^      package: /, "    package: "), swap(/^      ref: /, "    ref: "))],
  ["a value that starts with an at sign", swap(/^name: .*$/, "name: @gate")],
  ["U+0000 in a comment line (no YAML source may hold it)", (s) => `${s.replace(/\n*$/, "\n")}# \u0000\n`],
  ["U+0000 in a quoted value", swap(/^name: .*$/, 'name: "a\u0000b"')],
  ["a C1 control (U+0080) in a comment line", (s) => `${s.replace(/\n*$/, "\n")}# \u0080\n`],
  ["a next-line character (U+0085) in a comment inside the job", swap(USES_LINE, "    # note\u0085    if: false\n$&")],
  ["a line separator (U+2028) in a comment inside the job", swap(USES_LINE, "    # note\u2028    if: false\n$&")],
  ["a paragraph separator (U+2029) in a comment inside the job", swap(USES_LINE, "    # note\u2029    if: false\n$&")],
  ["a byte order mark in the middle of the file", swap(/^jobs:$/, "# \uFEFF\njobs:")],
  ["a byte order mark at the start of the file", (s) => `\uFEFF${s}`],
  ["a delete character (U+007F) in a comment line", (s) => `${s.replace(/\n*$/, "\n")}# \u007F\n`],
  ["a lone surrogate in a comment line", (s) => `${s.replace(/\n*$/, "\n")}# \uD800\n`],
  ["U+FFFE in a comment line", (s) => `${s.replace(/\n*$/, "\n")}# \uFFFE\n`],
  ["a no-break space before the comment after uses (YAML reads it into the value)", swap(/^(    uses: \S+) # /, "$1\u00A0# ")],
  ["a form feed in a comment line", (s) => `${s.replace(/\n*$/, "\n")}# \f\n`],
  ["carriage returns at the line ends", (s) => s.replace(/\n/g, "\r\n")],
  ["an empty file", () => ""],
];
for (const [name, change] of REFUSED) {
  test(`refused: ${name}`, () => {
    const base = text();
    const changed = change(base);
    assert.equal(changed !== base, true, "the fixture changes the caller");
    assert.equal(callerFaults(changed).length > 0, true, name);
  });
}
