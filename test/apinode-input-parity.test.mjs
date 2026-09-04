// EVERY API STEP'S DECLARED INPUTS ARE REALLY READ BY ITS TEMPLATE.
//
// The runtime infers an API step's inputs from the bare {{ name }} placeholders
// in its url, http_method, api_spec_uri, data, query_params and headers, and
// refuses to mount a step that
// declares an input no placeholder names. A value used through a filter — the
// offered idea list is rendered as {{ ideas | tojson }} — is invisible to that
// inference, so the template body carries the comment sentinel this package
// already uses elsewhere: it renders to nothing and keeps the name visible.
//
// Read the flow, never a copy of it: the file this suite reads is the file the
// platform runs, and it walks the pipeline's own steps AND every inlined
// subflow step, so no step of the run can drift out of parity unnoticed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
const ENV_VAR = /^[A-Z_][A-Z0-9_]*$/;
// Exactly the fields the runtime folds into its inferred placeholder set —
// url, http_method, api_spec_uri, data, query_params and headers. Anything
// narrower would let a future step hide a placeholder from this suite while
// the platform still infers it.
const TEMPLATE_FIELDS = [
  "url",
  "http_method",
  "api_spec_uri",
  "data",
  "query_params",
  "headers",
];

/** Every Flow in the file: the pipeline's own graph and each inlined subflow. */
function* flows(node, seen = new Set()) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  if (seen.has(node)) return;
  seen.add(node);
  if (node.component_type === "Flow") yield node;
  const refs = node.$referenced_components;
  if (refs && typeof refs === "object" && !Array.isArray(refs)) {
    for (const value of Object.values(refs)) yield* flows(value, seen);
  }
  if (node.subflow && typeof node.subflow === "object") yield* flows(node.subflow, seen);
}

/** The bare placeholder names the runtime reads out of one API step's template. */
function placeholderNames(node) {
  const parts = [];
  for (const field of TEMPLATE_FIELDS) {
    if (node[field] === undefined) continue;
    parts.push(JSON.stringify(node[field]));
  }
  const text = parts.join("\n");
  const names = new Set();
  PLACEHOLDER.lastIndex = 0;
  let match;
  while ((match = PLACEHOLDER.exec(text)) !== null) {
    if (match[1] && !ENV_VAR.test(match[1])) names.add(match[1]);
  }
  return names;
}

/** [flowId, stepId, step] for every API step that declares its inputs. */
function apiSteps() {
  const out = [];
  for (const flow of flows(oas)) {
    const refs = flow.$referenced_components ?? {};
    for (const [id, node] of Object.entries(refs)) {
      if (!node || node.component_type !== "ApiNode") continue;
      if (!Array.isArray(node.inputs)) continue;
      out.push([flow.id ?? flow.name, id, node]);
    }
  }
  return out;
}

test("every API step of the run declares only inputs its own template reads", () => {
  const steps = apiSteps();
  assert.ok(steps.length > 0, "the run has API steps to check");
  const dead = [];
  for (const [flowId, id, node] of steps) {
    const read = placeholderNames(node);
    for (const input of node.inputs) {
      if (!input || typeof input.title !== "string") continue;
      if (!read.has(input.title)) dead.push(`${flowId}/${id}: ${input.title}`);
    }
  }
  assert.deepEqual(dead, [], "no API step declares an input its template never names");
});

test("every placeholder an API step reads is an input it declares", () => {
  const unspoken = [];
  for (const [flowId, id, node] of apiSteps()) {
    const declared = new Set(
      node.inputs.filter((i) => i && typeof i.title === "string").map((i) => i.title),
    );
    for (const name of placeholderNames(node)) {
      if (!declared.has(name)) unspoken.push(`${flowId}/${id}: ${name}`);
    }
  }
  assert.deepEqual(unspoken, [], "no API step reads a placeholder it never declares");
});

test("the reservation step still validates the pick against the list it was offered", () => {
  const reserve = oas.$referenced_components.reserve_idea;
  assert.equal(reserve.component_type, "ApiNode");
  const declared = reserve.inputs.map((i) => i.title);
  assert.ok(declared.includes("ideas"), "the offered list stays an input of the reservation");
  const offered = reserve.data.input.offered;
  assert.match(offered, /\{\{\s*ideas\s*\|\s*tojson\s*\}\}/, "and the body sends that list on");
  assert.match(
    offered,
    /\{#[^#]*\{\{\s*ideas\s*\}\}[^#]*#\}/,
    "with the sentinel that keeps the filtered name visible to the runtime",
  );
  assert.ok(
    offered.replace(/\{#[^#]*#\}/g, "").trim().startsWith("{{"),
    "the sentinel renders to nothing, so the value the step sends is unchanged",
  );
});
