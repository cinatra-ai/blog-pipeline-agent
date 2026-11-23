// The pipeline's optional, hidden `draftNote` and `imagePrompt` inputs
// (cinatra-ai/cinatra#4264).
//
// The draft writer now takes an optional `note` and the image generator an
// optional `prompt`. A subflow input is filled only by a data edge, so the
// pipeline passes each one down from an input of its own: `draftNote` to the
// draft step's `note` and `imagePrompt` to the image step's `prompt`. Both are
// plain plumbing: canonical strings, empty by default, hidden from the form,
// and each the only thing that fills its port. The embedded copies of the two
// children must carry the ports, or the edges land on nothing. These tests read
// the SHIPPED flow file and README.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const readme = readFileSync(join(root, "README.md"), "utf8");
const refs = oas.$referenced_components;
const start = refs.start;

const WIRES = [
  { input: "draftNote", step: "draft_flow", child: "blog-draft-writer-agent", port: "note", node: "write" },
  { input: "imagePrompt", step: "image_flow", child: "blog-image-generator-agent", port: "prompt", node: "generate" },
];

const fromStart = (output) =>
  oas.data_flow_connections.filter(
    (c) => c.source_node.$component_ref === "start" && c.source_output === output,
  );
const into = (edges, node, input) =>
  edges.filter(
    (c) => c.destination_node.$component_ref === node && c.destination_input === input,
  );

for (const { input, step, child, port, node } of WIRES) {
  const subflowId = `${child}-subflow`;
  const sub = refs[subflowId];
  const inner = sub.$referenced_components;

  test(`the flow and its start node both declare \`${input}\` as a canonical, empty-by-default string`, () => {
    for (const [where, inputs] of [
      ["flow", oas.inputs],
      ["start node", start.inputs],
    ]) {
      const found = inputs.filter((i) => i.title === input);
      assert.equal(found.length, 1, `${where} declares ${input} exactly once`);
      // Canonical: the title, the string type and the empty default - no schema, no format.
      assert.deepEqual(found[0], { title: input, type: "string", default: "" });
    }
  });

  test(`\`${input}\` is hidden and never required, so the form is unchanged`, () => {
    assert.ok(start.metadata.cinatra.hidden.includes(input), `${input} is hidden`);
    assert.ok(!start.metadata.cinatra.required.includes(input), `${input} is not required`);
    assert.deepEqual(start.metadata.cinatra.required, ["brief", "ideaCount"]);
  });

  test(`the start node's \`${input}\` has one consumer: ${step}'s \`${port}\``, () => {
    const edges = fromStart(input);
    assert.equal(edges.length, 1, `no fan-out from start.${input}`);
    assert.equal(edges[0].destination_node.$component_ref, step);
    assert.equal(edges[0].destination_input, port);
    // Named like the pipeline's other start edges.
    assert.equal(edges[0].name, `${input}:start->${step}`);
    assert.equal(edges[0].id, `${input}:start->${step}.${port}`);
    assert.equal(into(oas.data_flow_connections, step, port).length, 1, `one edge into ${step}.${port}`);
  });

  test(`${step} runs the embedded ${child}, whose copy declares \`${port}\``, () => {
    assert.equal(refs[step].subflow.$component_ref, subflowId);
    for (const [where, inputs] of [
      ["embedded flow", sub.inputs],
      ["embedded start node", inner[`${child}__start`].inputs],
    ]) {
      const found = inputs.filter((i) => i.title === port);
      assert.equal(found.length, 1, `${where} declares ${port} exactly once`);
      assert.deepEqual(found[0], { title: port, type: "string", default: "" });
    }
    assert.ok(inner[`${child}__start`].metadata.cinatra.hidden.includes(port), `the embedded ${port} is hidden`);
  });

  test(`inside the embedded ${child}, \`${port}\` reaches the model step and is read in its turn`, () => {
    const prefix = `${child}__`;
    const edges = into(sub.data_flow_connections, `${prefix}${node}`, port);
    assert.equal(edges.length, 1, `one edge into ${node}.${port}`);
    assert.equal(edges[0].source_node.$component_ref, `${prefix}start`);
    assert.equal(edges[0].source_output, port);
    assert.equal(edges[0].name, `${prefix}start_${port}_to_${node}_${port}`);
    const model = inner[`${prefix}${node}`];
    const p = model.inputs.filter((i) => i.title === port);
    assert.equal(p.length, 1);
    assert.equal(p[0].type, "string");
    assert.equal(p[0].default, "");
    assert.match(model.data.user, new RegExp(`\\{\\{ ${port} \\}\\}`));
    assert.match(model.data.system, new RegExp(`When \`${port}\` is not empty`));
    assert.match(model.data.system, new RegExp(`When \`${port}\` is empty`));
  });

  test(`the README names \`${input}\``, () => {
    assert.match(readme, new RegExp(`\`${input}\``));
  });
}

// The manifest's `cinatra.lifecycle.regenerate` declaration (cinatra-ai/cinatra#4264).
//
// Per artifact-filing node it names the producing step a Regenerate reruns and
// the plain string input of that step the reviewer's note goes into. The
// application refuses the declaration at compile time unless the names fit the
// flow (checkRegenerateDeclaration in packages/agents/src/verdaccio/package-contract.ts).
// These tests read the SHIPPED package.json and flow file and apply that same
// rule, so a renamed node or input fails here and not at an install.

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const DECLARED = [
  { artifactNode: "write_draft", step: "draft_flow", noteInput: "note" },
  { artifactNode: "file_image", step: "image_flow", noteInput: "prompt" },
];
const ref = (v) => v?.$component_ref;
// Exactly one canonical { title, type: "string" } port of that name.
const stringPort = (ports, name) => {
  const found = (ports ?? []).filter((p) => p.title === name);
  return found.length === 1 && found[0].type === "string";
};

test("the manifest declares both Regenerate entries and nothing else under lifecycle", () => {
  assert.deepEqual(pkg.cinatra.lifecycle?.regenerate, DECLARED);
  assert.deepEqual(Object.keys(pkg.cinatra.lifecycle), ["regenerate"]);
});

test("the declaration fits the schema: unique nodes, identifier note inputs, no other keys", () => {
  const entries = pkg.cinatra.lifecycle.regenerate;
  assert.equal(new Set(entries.map((e) => e.artifactNode)).size, entries.length);
  for (const e of entries) {
    assert.deepEqual(Object.keys(e).sort(), ["artifactNode", "noteInput", "step"]);
    assert.match(e.noteInput, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.ok(!(e.noteInput in Object.prototype));
    assert.notEqual(e.noteInput, "lifecycleRepairRequest");
  }
});

for (const { artifactNode, step, noteInput } of DECLARED) {
  test(`${step} -> ${artifactNode}: both are top-level nodes of the right kind, joined by a data edge`, () => {
    const tops = oas.nodes.map(ref);
    assert.ok(tops.includes(step) && tops.includes(artifactNode), "both are top-level nodes");
    assert.equal(refs[step].component_type, "FlowNode");
    // Only an ApiNode signs its own step id when it files an artifact.
    assert.equal(refs[artifactNode].component_type, "ApiNode");
    assert.ok(
      oas.data_flow_connections.some(
        (c) => ref(c.source_node) === step && ref(c.destination_node) === artifactNode,
      ),
      `a data edge runs from ${step} to ${artifactNode}`,
    );
  });

  test(`${step}: \`${noteInput}\` is a plain string input of the subflow's start node`, () => {
    const sub = refs[ref(refs[step].subflow)];
    assert.equal(sub.component_type, "Flow");
    const subStart = (sub.$referenced_components ?? {})[ref(sub.start_node)] ?? refs[ref(sub.start_node)];
    assert.equal(subStart.component_type, "StartNode");
    assert.ok(stringPort(subStart.inputs, noteInput), "the subflow's StartNode carries it");
    if (Array.isArray(refs[step].inputs)) assert.ok(stringPort(refs[step].inputs, noteInput));
  });

  test(`${step}: exactly one edge fills \`${noteInput}\`, from a string output of the start node that feeds nothing else`, () => {
    const startId = ref(oas.start_node);
    const incoming = oas.data_flow_connections.filter(
      (c) => ref(c.destination_node) === step && c.destination_input === noteInput,
    );
    assert.equal(incoming.length, 1);
    const output = incoming[0].source_output;
    assert.equal(ref(incoming[0].source_node), startId);
    assert.ok(stringPort(refs[startId].outputs ?? refs[startId].inputs, output), "the start node's port");
    assert.ok(stringPort(oas.inputs, output), "the flow's root input");
    const fanOut = oas.data_flow_connections.filter(
      (c) => ref(c.source_node) === startId && c.source_output === output,
    );
    assert.equal(fanOut.length, 1, `${output} feeds nothing else`);
  });
}

test("the note inputs are fed by the start outputs draftNote and imagePrompt", () => {
  const source = (step, input) =>
    oas.data_flow_connections.find((c) => ref(c.destination_node) === step && c.destination_input === input)
      .source_output;
  assert.equal(source("draft_flow", "note"), "draftNote");
  assert.equal(source("image_flow", "prompt"), "imagePrompt");
});
