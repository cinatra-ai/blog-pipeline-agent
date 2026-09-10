// Regression pins for cinatra-ai/cinatra#3380.
//
// The pipeline used to carry its own copy of the idea generator's flow and of
// the draft writer. Both copies went stale: the generator had moved on to
// emitting each idea as one piece of plain text whose first line is its title,
// and the writer to taking that text as a plain string, while the embedded
// copies still declared objects and still carried the generator's older system
// prompt — the one that asked for `{ideas:[{title, summary, outline:[...]}],
// notes}` and pointed at a SKILL.md that has since been removed. Five plain-text
// ideas measured against an object declaration is why a real run parked at the
// "Select blog idea" gate with five empty objects.
//
// The pipeline no longer embeds a copy of the generator at all: it offers the
// organisation's stored ideas by reference and resolves the reserved one to its
// full text, so the idea reaches the writer as a plain string. These tests hold
// that road open. Every assertion below fails on the flow this pack shipped at
// f8971d50e992 and passes here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const components = oas.$referenced_components;

const slot = (componentId, kind, title) =>
  (components[componentId]?.[kind] ?? []).find((s) => s.title === title);

/** Every string the flow carries, prompts and descriptions alike. */
function everyText(node, found = []) {
  if (typeof node === "string") found.push(node);
  else if (Array.isArray(node)) for (const v of node) everyText(v, found);
  else if (node && typeof node === "object")
    for (const v of Object.values(node)) everyText(v, found);
  return found;
}

const shorten = (t) => (t.length > 120 ? `${t.slice(0, 120)}…` : t);

test("the pipeline embeds no copy of the idea generator's flow", () => {
  // The copy was `blog-idea-generator-agent-subflow`. Ideas now arrive from the
  // organisation's own stored artifacts, so no copy is carried and none can go
  // stale against the generator's pin again.
  const embedded = Object.keys(components).filter((id) =>
    id.includes("blog-idea-generator-agent"),
  );
  assert.deepEqual(
    embedded,
    [],
    "a copy of the idea generator is embedded again — it will go stale against that pack's own pin",
  );
});

test("exactly one step produces the idea, and it produces plain text", () => {
  const producers = Object.entries(components).filter(([, c]) =>
    (c.outputs ?? []).some((o) => o.title === "idea"),
  );
  assert.equal(
    producers.length,
    1,
    `expected one step to produce the idea, found ${producers.map(([id]) => id).join(", ") || "none"}`,
  );
  const [producerId, producer] = producers[0];
  const idea = producer.outputs.find((o) => o.title === "idea");
  assert.equal(
    idea.type,
    "string",
    `${producerId} must hand on the whole idea as one piece of plain text, not as an object`,
  );
});

test("the embedded draft writer takes the idea as a plain string", () => {
  // The draft writer's own pin declares `idea` a string; the embedded copy must
  // declare the same, or the writer is handed a shape it cannot read.
  const idea = slot("blog-draft-writer-agent-subflow", "inputs", "idea");
  assert.ok(idea, "the embedded draft writer declares no idea input");
  assert.equal(idea.type, "string");
});

test("the idea keeps its shape all the way from the reserve step to the writer", () => {
  const [producerId] = Object.entries(components).find(([, c]) =>
    (c.outputs ?? []).some((o) => o.title === "idea"),
  );
  const edge = (oas.data_flow_connections ?? []).find(
    (e) =>
      e.source_node?.$component_ref === producerId &&
      e.source_output === "idea" &&
      e.destination_input === "idea",
  );
  assert.ok(edge, `no edge carries ${producerId}'s idea onward`);

  const target = components[edge.destination_node?.$component_ref];
  assert.equal(
    target?.subflow?.$component_ref,
    "blog-draft-writer-agent-subflow",
    "the idea must land in the step that runs the draft writer",
  );

  const from = components[producerId].outputs.find((o) => o.title === "idea").type;
  const to = slot("blog-draft-writer-agent-subflow", "inputs", "idea").type;
  assert.equal(from, "string");
  assert.equal(to, from, "the idea changes shape between the reserve step and the writer");
});

test("the idea generator's removed SKILL.md is named nowhere", () => {
  // #2086 removed `…/blog-idea-generator-agent/SKILL.md`. Other agents in this
  // flow legitimately carry a SKILL.md of their own, so only the removed one is
  // an offence here.
  const offenders = everyText(oas)
    .filter((t) => t.includes("blog-idea-generator-agent/SKILL.md"))
    .map(shorten);
  assert.deepEqual(offenders, []);
});

test("no prompt still asks for the idea object the generator stopped emitting", () => {
  const offenders = everyText(oas)
    .filter((t) => /ideas\s*:\s*\[\s*\{\s*title/.test(t))
    .map(shorten);
  assert.deepEqual(
    offenders,
    [],
    "a prompt still asks for the {title, summary, outline} idea object",
  );
});

test("the embedded writer carries its pin's prompt, not the removed-SKILL.md one", () => {
  const texts = everyText(components["blog-draft-writer-agent-subflow"]);
  const stale = texts.filter((t) => t.includes("Follow the SKILL.md step-by-step")).map(shorten);
  assert.deepEqual(stale, [], "the embedded writer still carries its older prompt");
  assert.ok(
    texts.some((t) =>
      t.includes("`idea: string` (required): the whole idea, as ONE piece of plain text"),
    ),
    "the embedded writer's prompt must be the one its own pin carries, which reads the idea as plain text",
  );
});

test("every input the run starts from is one the person is asked for, or a hidden one", () => {
  // The gate offers the organisation's stored ideas; `ideaCount` says how many
  // of them to offer, and the four writing controls carry their own defaults.
  // An input in neither list is never prompted for and never passed on — the
  // run simply proceeds with whatever the dispatcher happened to send, which is
  // how a step ends up with nothing usable in it.
  const start = components.start;
  const declared = start.inputs.map((i) => i.title).sort();
  const cinatra = start.metadata.cinatra;
  const covered = [...(cinatra.required ?? []), ...(cinatra.hidden ?? [])].sort();
  assert.deepEqual(
    declared.filter((t) => !covered.includes(t)),
    [],
    "a start input is neither asked for nor hidden",
  );
  assert.deepEqual(
    covered.filter((t) => !declared.includes(t)),
    [],
    "required or hidden names an input the start node does not declare",
  );
});
