// cinatra#3035 — the LinkedIn post is written while the run is going, and its
// one review is opened on exactly that write.
//
// The six arms pin: one mid-run write of the LinkedIn post on the LinkedIn
// post-draft type, fed by the LinkedIn writer; that write and the step that names
// it standing between the writer and the LinkedIn pause on every road; the
// LinkedIn pause carrying the artifact-review marker and the run filling the input
// it names through the declared tool's `review` operation; the set naming the
// LinkedIn post alone, in the shape the review core parses; the end node binding
// nothing; and the declared module filing the set it is handed without touching a
// table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { extensionTool } from "../cinatra/tools/stored-ideas.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const parts = oas.$referenced_components;

const LINKEDIN_EXTENSION = "@cinatra-ai/linkedin-artifacts";
const LINKEDIN_TYPE = "@cinatra-ai/linkedin:post-draft";
const WRITER = "linkedin_flow";
const GATE = "linkedin_review_gate";

const ownNodes = () =>
  oas.nodes
    .map((n) => n.$component_ref)
    .filter((id) => parts[id] && parts[id].component_type);
const edgeInto = (node, input) =>
  oas.data_flow_connections.find(
    (e) => e.destination_node.$component_ref === node && e.destination_input === input,
  );
/** The pipeline's own mid-run writes of the LinkedIn post. */
const linkedinWrites = () =>
  ownNodes().filter((id) => {
    const node = parts[id];
    return (
      node.component_type === "ApiNode" &&
      node.data?.tool === "artifact_materialize" &&
      node.data?.input?.extension === LINKEDIN_EXTENSION
    );
  });
/** The step that fills the input the LinkedIn pause's marker names. */
const projectionStep = () => {
  const named = parts[GATE].metadata?.cinatra?.artifactReview?.targetsInput;
  assert.equal(typeof named, "string", "the LinkedIn pause names the input its targets travel in");
  const edge = edgeInto(GATE, named);
  assert.ok(edge, `the run fills the input "${named}"`);
  return { id: edge.source_node.$component_ref, named, edge };
};

test("the run writes its LinkedIn post while it is still going, as a LinkedIn post draft", () => {
  const writes = linkedinWrites();
  assert.equal(writes.length, 1, "exactly one mid-run write of the LinkedIn post");
  const id = writes[0];
  const node = parts[id];
  assert.equal(node.data.input.objectTypeId, LINKEDIN_TYPE);
  assert.equal(node.data.input.declaredMime, "text/plain");
  assert.equal(node.data.input.node_id, id, "the write names its own step");
  assert.equal(node.metadata.cinatra.riskClass, "write");
  const content = edgeInto(id, "content");
  assert.ok(content, "the write's content is edge-sourced");
  assert.equal(content.source_node.$component_ref, WRITER);
  assert.equal(content.source_output, "post");
  const title = edgeInto(id, "title");
  assert.ok(title, "the write's title is edge-sourced");
  assert.equal(title.source_node.$component_ref, WRITER);
  assert.equal(title.source_output, "title");
});

test("the LinkedIn post is written after the writer and before its review, on every road", () => {
  const writes = linkedinWrites();
  assert.equal(writes.length, 1, "one write of the LinkedIn post to place");
  const write = writes[0];
  const projection = projectionStep().id;
  const next = new Map();
  for (const edge of oas.control_flow_connections) {
    const from = edge.from_node.$component_ref;
    if (!next.has(from)) next.set(from, []);
    next.get(from).push(edge.to_node.$component_ref);
  }
  const ends = ownNodes().filter((id) => parts[id].component_type === "EndNode");
  const roads = [];
  const walk = (id, road) => {
    if (road.includes(id)) return;
    const here = [...road, id];
    if (ends.includes(id)) {
      roads.push(here);
      return;
    }
    for (const to of next.get(id) ?? []) walk(to, here);
  };
  walk(oas.start_node.$component_ref, []);
  assert.ok(roads.length > 0, "at least one road reaches the end");
  const order = [WRITER, write, projection, GATE];
  for (const road of roads) {
    const seen = order.map((id) => road.indexOf(id));
    for (let i = 0; i < order.length; i += 1) {
      assert.notEqual(seen[i], -1, `the road ${road.join("->")} skips ${order[i]}`);
    }
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(seen[i - 1] < seen[i], `${order[i - 1]} comes before ${order[i]} on every road`);
    }
  }
});

test("the LinkedIn review step carries the marker, and the run fills the input it names", () => {
  const gate = parts[GATE];
  assert.equal(gate.metadata.cinatra.artifactReview?.targetsInput, "reviewTargets");
  assert.ok(
    (gate.inputs ?? []).some((i) => i.title === "reviewTargets"),
    "the LinkedIn pause declares the input its marker names",
  );
  const { id } = projectionStep();
  const node = parts[id];
  assert.equal(node.component_type, "ApiNode");
  assert.equal(node.data.tool, "extension_tool");
  assert.equal(node.data.input.name, "stored_ideas");
  assert.deepEqual(Object.keys(node.data.input.input).sort(), ["op", "reviewTargets"]);
  assert.equal(node.data.input.input.op, "review");
  assert.equal(node.data.result_input_passthrough, true);
  assert.equal(node.data.result_id_field, "ok");
  assert.equal(node.data.agent_run_id, "{{ cinatra_run_id }}");
});

test("the LinkedIn review names the LinkedIn post alone, in the shape the review core parses", () => {
  const { id, named } = projectionStep();
  const template = parts[id].data.input.input[named];
  assert.equal(typeof template, "string", "one JSON array string, which is what is parsed");
  const rendered = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name) => `RENDERED-${name}`);
  const targets = JSON.parse(rendered);
  assert.ok(Array.isArray(targets), "a JSON array of references");
  assert.equal(targets.length, 1, "the LinkedIn post alone");
  assert.deepEqual(Object.keys(targets[0]).sort(), ["artifactId", "representationRevisionId"]);
  const writes = linkedinWrites();
  assert.equal(writes.length, 1);
  const declared = (parts[id].inputs ?? []).map((i) => i.title);
  for (const [key, output] of [
    ["artifactId", "artifactId"],
    ["representationRevisionId", "representationRevisionId"],
  ]) {
    const value = targets[0][key];
    assert.match(value, /^RENDERED-/, `the ${key} is a placeholder the run fills`);
    const input = value.slice("RENDERED-".length);
    assert.ok(declared.includes(input), `the step declares the input "${input}"`);
    const edge = edgeInto(id, input);
    assert.ok(edge, `"${input}" is edge-sourced`);
    assert.equal(edge.source_node.$component_ref, writes[0]);
    assert.equal(edge.source_output, output);
  }
});

test("the end node binds nothing: the LinkedIn post is filed during the run, not at its end", () => {
  const endOutputs = parts.end.outputs;
  assert.deepEqual(
    endOutputs.filter((o) => o.cinatra?.artifact).map((o) => o.title),
    [],
    "no end output carries a binding",
  );
  assert.deepEqual(
    oas.outputs.filter((o) => o.cinatra?.artifact).map((o) => o.title),
    [],
    "no flow output carries a binding",
  );
  assert.deepEqual(endOutputs.map((o) => o.title).sort(), ["linkedinPost", "linkedinTitle"]);
  assert.deepEqual(oas.outputs.map((o) => o.title).sort(), ["linkedinPost", "linkedinTitle"]);
});

/** Ports that record every data call and every filing. */
function recordingPorts() {
  const calls = [];
  const filed = [];
  const record = (operation) => async (request) => {
    calls.push({ operation, ...request });
    return {};
  };
  return {
    calls,
    filed,
    data: {
      select: record("select"),
      insertIfAbsent: record("insertIfAbsent"),
      updateWhere: record("updateWhere"),
    },
    artifacts: {
      list: record("list"),
      contentRead: record("contentRead"),
    },
    review: {
      file(targets) {
        filed.push(targets);
      },
    },
    clock: { now: () => new Date("2026-09-30T00:00:00.000Z") },
  };
}

test("the declared module files the set it is handed and touches no table", async () => {
  const reference = { artifactId: "linkedin-1", representationRevisionId: "linkedin-rev-1" };
  const p = recordingPorts();
  const result = await extensionTool({
    input: { op: "review", reviewTargets: JSON.stringify([reference]) },
    ports: p,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(p.filed, [[reference]], "the parsed set is filed once");
  assert.deepEqual(p.calls, [], "no data call and no read");

  const unreadable = recordingPorts();
  await extensionTool({ input: { op: "review", reviewTargets: "{not json" }, ports: unreadable });
  assert.deepEqual(unreadable.filed, ["{not json"], "a set it cannot read is filed as it arrived");
  assert.deepEqual(unreadable.calls, []);

  const missing = recordingPorts();
  await extensionTool({ input: { op: "review" }, ports: missing });
  assert.equal(missing.filed.length, 1, "a missing set is still handed to the host");
  assert.equal(missing.filed[0], undefined);
  assert.deepEqual(missing.calls, []);

  const empty = recordingPorts();
  await extensionTool({ input: { op: "review", reviewTargets: "[]" }, ports: empty });
  assert.deepEqual(empty.filed, [[]], "an empty set is still handed to the host");
  assert.deepEqual(empty.calls, []);
});
