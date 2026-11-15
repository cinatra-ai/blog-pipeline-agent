// The pipeline's `cinatra.lifecycle.regenerate` declaration (cinatra-ai/cinatra#4264).
//
// A review's Regenerate reruns the step that made the reviewed work and puts the
// reviewer's note into the ONE text input that step declares. The pipeline has two
// such steps: the draft step (`draft_flow`, which files the post through
// `write_draft`; the note goes into the writer's `note`) and the picture step
// (`image_flow`, which files the image through `file_image`; the note goes into the
// generator's `prompt`). Both inputs are filled by one dedicated edge from the
// flow's start node (`draftNote`, `imagePrompt`), which is what makes the note land
// in that input and in no other place.
//
// The host refuses a declaration its graph check does not accept, at install and at
// import. `checkRegenerate` below is a copy of that check's rules (the host's
// `checkRegenerateDeclaration`, cinatra#4633 head 104242e2cda4); the cases that run
// it on the SHIPPED flow and manifest are the proof that the host accepts them. The
// last cases run it on a broken copy so that it cannot pass by saying nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const EXPECTED = [
  { artifactNode: "write_draft", step: "draft_flow", noteInput: "note" },
  { artifactNode: "file_image", step: "image_flow", noteInput: "prompt" },
];
const declared = manifest.cinatra.lifecycle?.regenerate;

const idOf = (r) => (r && typeof r.$component_ref === "string" ? r.$component_ref : null);
const one = (ports, name, where) => {
  const found = (Array.isArray(ports) ? ports : []).filter((p) => p?.title === name);
  if (found.length !== 1) return `${where} has ${found.length} ports titled "${name}"`;
  return found[0].type === "string" ? null : `${where} port "${name}" is not a string port`;
};

/** The host's rules for one declaration against one parsed flow: null when accepted, else why not. */
function checkRegenerate(flow, entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 16) return "the list is not 1 to 16 entries";
  if (new Set(entries.map((e) => e.artifactNode)).size !== entries.length) return "artifactNode is not unique";
  const refs = flow.$referenced_components;
  const top = new Set(flow.nodes.map(idOf));
  const edges = flow.data_flow_connections;
  const startId = idOf(flow.start_node);
  for (const e of entries) {
    if (JSON.stringify(Object.keys(e).sort()) !== '["artifactNode","noteInput","step"]') return "an entry has other keys";
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(e.noteInput) || e.noteInput === "lifecycleRepairRequest") return "noteInput name";
    if (e.noteInput in Object.prototype) return "noteInput is a reserved name";
    for (const id of [e.step, e.artifactNode]) if (!top.has(id) || !refs[id]) return `${id} is not a top-level node`;
    const step = refs[e.step];
    if (!["ApiNode", "AgentNode", "FlowNode"].includes(step.component_type)) return "step kind";
    if (refs[e.artifactNode].component_type !== "ApiNode") return "artifactNode must be an ApiNode";
    const linked = edges.some((c) => idOf(c.source_node) === e.step && idOf(c.destination_node) === e.artifactNode);
    if (e.step !== e.artifactNode && !linked) return "no data edge from step to artifactNode";
    let problem;
    if (step.component_type === "FlowNode") {
      const sub = refs[idOf(step.subflow)];
      const subStart = sub?.$referenced_components?.[idOf(sub.start_node)];
      problem = one(subStart?.inputs, e.noteInput, "the subflow's start node");
      if (!problem && Array.isArray(step.inputs)) problem = one(step.inputs, e.noteInput, "step");
    } else problem = one(step.inputs, e.noteInput, "step");
    if (problem) return problem;
    const into = edges.filter((c) => idOf(c.destination_node) === e.step && c.destination_input === e.noteInput);
    if (into.length !== 1) return `${into.length} edges end at ${e.step}.${e.noteInput}`;
    const out = into[0].source_output;
    if (idOf(into[0].source_node) !== startId) return "the note edge does not start at the start node";
    problem = one(refs[startId].inputs, out, "the start node") ?? one(flow.inputs, out, "the flow's inputs");
    if (problem) return problem;
    const fan = edges.filter((c) => idOf(c.source_node) === startId && c.source_output === out);
    if (fan.length !== 1) return `the start output "${out}" feeds another input too`;
  }
  return null;
}

test("the manifest declares the regenerate list: the draft step's note and the picture step's prompt", () => {
  assert.deepEqual(declared, EXPECTED);
  assert.deepEqual(Object.keys(manifest.cinatra.lifecycle), ["regenerate"]);
});

test("the host's check accepts the declared list on the shipped flow", () => {
  assert.ok(Array.isArray(declared), "the manifest declares no regenerate list");
  assert.equal(checkRegenerate(oas, declared), null);
});

test("each declared note input is filled by exactly one start edge, from a hidden, optional input", () => {
  assert.ok(Array.isArray(declared), "the manifest declares no regenerate list");
  const start = oas.$referenced_components.start;
  const WIRE = { draft_flow: "draftNote", image_flow: "imagePrompt" };
  for (const { step, noteInput } of declared) {
    const into = oas.data_flow_connections.filter(
      (c) => c.destination_node.$component_ref === step && c.destination_input === noteInput,
    );
    assert.equal(into.length, 1, `${step}.${noteInput} has one edge`);
    assert.equal(into[0].source_output, WIRE[step]);
    assert.ok(start.metadata.cinatra.hidden.includes(WIRE[step]), `${WIRE[step]} is hidden`);
    assert.ok(!start.metadata.cinatra.required.includes(WIRE[step]), `${WIRE[step]} is optional`);
  }
});

test("the check refuses a note input the step does not declare", () => {
  const bad = [{ artifactNode: "file_image", step: "image_flow", noteInput: "post" }];
  assert.notEqual(checkRegenerate(oas, bad), null);
  assert.notEqual(checkRegenerate(oas, [{ ...EXPECTED[0], noteInput: "nothing" }]), null);
});

test("the check refuses a note input that a second edge also fills", () => {
  const copy = structuredClone(oas);
  copy.data_flow_connections.push({ ...copy.data_flow_connections.find((c) => c.source_output === "draftNote"), name: "x", id: "x" });
  assert.match(checkRegenerate(copy, EXPECTED), /2 edges end at draft_flow\.note/);
});

test("the check refuses a start output that feeds another input, and an artifact node that is not an ApiNode", () => {
  const fan = structuredClone(oas);
  const edge = fan.data_flow_connections.find((c) => c.source_output === "imagePrompt");
  fan.data_flow_connections.push({ ...edge, destination_node: { $component_ref: "draft_flow" }, destination_input: "tone" });
  assert.match(checkRegenerate(fan, EXPECTED), /feeds another input too/);
  const kind = structuredClone(oas);
  kind.$referenced_components.file_image.component_type = "AgentNode";
  assert.match(checkRegenerate(kind, EXPECTED), /must be an ApiNode/);
});
