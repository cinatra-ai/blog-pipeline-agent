// The pipeline's declared pauses are its real pauses (cinatra-ai/cinatra#3035).
//
// A run of this pipeline pauses for: the one brand-voice pick, the stored-ideas
// pick, one review per artifact (the post and its picture, at the review step
// the run parks at) and the LinkedIn post. Nothing else asks the person.
//
// The embedded draft writer and image agent declare one more context slot each
// in their own packages: draftContext (stored blog ideas) and
// imagePromptContext (stored blog posts). Standing alone, each agent asks for
// that background. Inside this pipeline, the steps in front of them already
// answer it: the writer is handed the picked idea as its `idea` input, and the
// image agent is handed the drafted post as its `post` input. The embedded
// copies used to carry their own author-placed context step for these slots,
// and the host runs an author-placed step as written, so each run paused twice
// more ("Draft Context", "Image Prompt Context") for a question the run had
// already answered.
//
// The host (cinatra `docker/wayflow/context_subflow_injection.py`) puts a
// context pause in front of every slot a definition declares, unless the
// definition carries its own context step for it (which pauses too) or a
// parent-satisfied line of the pipeline hands the parent's pick down. So the
// pauses of a mounted run are: every InputMessageNode in the file, plus one per
// declared slot that no parent-satisfied line covers. These tests count them
// that way. They fail on the pack commit cde401d4, where both embedded copies
// still declare and resolve their own slot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components;
const cin = oas.metadata.cinatra;

const WRITER = "blog-draft-writer-agent-subflow";
const IMAGE = "blog-image-generator-agent-subflow";
const MARKER_PREFIXES = [
  "author-placed-context-resolution-for-",
  "loader-injected-context-resolution-for-",
];

/** Every Flow definition in the file: the pipeline and each embedded agent. */
function* flows(node, seen = new Set()) {
  if (!node || typeof node !== "object" || Array.isArray(node) || seen.has(node)) return;
  seen.add(node);
  if (node.component_type === "Flow") yield node;
  for (const value of Object.values(node.$referenced_components ?? {})) yield* flows(value, seen);
}

/** Every component of the file, nested ones included. */
function* components(node) {
  if (Array.isArray(node)) {
    for (const v of node) yield* components(v);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.component_type === "string") yield node;
  for (const v of Object.values(node)) yield* components(v);
}

/** The slot a context step resolves, read from its purpose marker; else null. */
function markerSlot(component) {
  const purpose = component?.metadata?.cinatra?.purpose;
  if (typeof purpose !== "string") return null;
  for (const prefix of MARKER_PREFIXES) {
    if (purpose.startsWith(prefix)) return purpose.slice(prefix.length);
  }
  return null;
}

/** The pauses a mounted run of this file makes, by name. */
function realPauses() {
  const pauses = new Set();
  for (const c of components(oas)) {
    if (c.component_type === "InputMessageNode" && !c.id.startsWith("ctx-")) pauses.add(c.id);
  }
  const lines = cin.parentSatisfiedContextSlots ?? [];
  for (const flow of flows(oas)) {
    const own = flow.metadata?.cinatra;
    for (const slot of own?.contextSlots ?? []) {
      const satisfied = lines.some(
        (l) => l.childPackage === own.packageName && l.childSlotId === slot.slotId,
      );
      if (!satisfied) pauses.add(`context:${slot.slotId}`);
    }
  }
  // An author-placed context step pauses on its own, declared or not.
  for (const c of components(oas)) {
    const slot = markerSlot(c);
    if (slot) pauses.add(`context:${slot}`);
  }
  return [...pauses].sort();
}

test("#3035: the run pauses only where the pipeline says it does", () => {
  assert.deepEqual(realPauses(), [
    "context:brandVoice",
    "draft_review_gate",
    "idea_selection_gate",
    "linkedin_review_gate",
  ]);
});

test("#3035: no embedded agent carries a context step of its own", () => {
  const steps = [...components(oas)]
    .filter((c) => markerSlot(c) !== null || /(^|-)context_select_gate$/.test(c.id ?? ""))
    .map((c) => c.id);
  assert.deepEqual(steps, [], "an embedded copy still asks for its own context");
});

test("#3035: every context slot an embedded agent keeps is answered by the pipeline's pick", () => {
  const lines = cin.parentSatisfiedContextSlots ?? [];
  for (const flow of flows(oas)) {
    if (flow === oas) continue;
    const own = flow.metadata?.cinatra;
    for (const slot of own?.contextSlots ?? []) {
      assert.ok(
        lines.some((l) => l.childPackage === own.packageName && l.childSlotId === slot.slotId),
        `${own.packageName} slot ${slot.slotId} is not handed down by the pipeline, so it pauses`,
      );
    }
  }
});

for (const [subflow, slot, consumer, answeredBy] of [
  [WRITER, "draftContext", "blog-draft-writer-agent__write", ["reserve_idea", "idea", "draft_flow", "idea"]],
  [IMAGE, "imagePromptContext", "blog-image-generator-agent__generate", ["draft_flow", "content", "image_flow", "post"]],
]) {
  test(`#3035: ${slot} is answered by the step in front of it, and its input gets no references`, () => {
    const def = refs[subflow];
    assert.ok(def, `${subflow} is not embedded`);
    const declared = (def.metadata.cinatra.contextSlots ?? []).map((s) => s.slotId);
    assert.ok(!declared.includes(slot), `${subflow} still declares ${slot}, so the host asks for it`);

    // The step in front of the agent already hands it what the slot asked for.
    const [from, out, to, input] = answeredBy;
    assert.ok(
      (oas.data_flow_connections ?? []).some(
        (e) =>
          e.source_node?.$component_ref === from &&
          e.source_output === out &&
          e.destination_node?.$component_ref === to &&
          e.destination_input === input,
      ),
      `${from}.${out} no longer reaches ${to}.${input}`,
    );

    // The agent's own step still takes the background input, as an empty list
    // from the agent's start: no references, and no pause to fill it.
    const title = `${slot}ContextSlotBindings`;
    const startId = def.start_node.$component_ref;
    const start = def.$referenced_components[startId];
    const startInput = (start.inputs ?? []).find((i) => i.title === title);
    assert.ok(startInput, `${subflow}'s start has no ${title} input`);
    assert.equal(startInput.type, "array");
    assert.deepEqual(startInput.default, []);
    assert.ok(start.metadata.cinatra.hidden.includes(title), `${title} must not be a field a person sees`);
    const flowInput = (def.inputs ?? []).find((i) => i.title === title);
    assert.deepEqual(flowInput, startInput, `${subflow}'s inputs and its start disagree on ${title}`);
    const target = def.$referenced_components[consumer];
    const takes = (target.inputs ?? []).find((i) => i.title === title);
    assert.ok(takes, `${consumer} no longer takes ${title}`);
    assert.equal(takes.type, "array");
    const feeds = (def.data_flow_connections ?? []).filter(
      (e) => e.destination_node?.$component_ref === consumer && e.destination_input === title,
    );
    assert.equal(feeds.length, 1, `${consumer}.${title} has ${feeds.length} sources`);
    assert.equal(feeds[0].source_node.$component_ref, startId);
    assert.equal(feeds[0].source_output, title);

    // The pipeline sends nothing into it.
    assert.ok(
      !(oas.data_flow_connections ?? []).some(
        (e) => e.destination_node?.$component_ref === to && e.destination_input === title,
      ),
      `the pipeline feeds ${to}.${title}`,
    );

    // Nothing is left that only served the removed step.
    const titles = [...(def.inputs ?? []), ...(start.inputs ?? [])].map((i) => i.title);
    for (const gone of [`${slot}ParentPackageName`, `${slot}SlotId`]) {
      assert.ok(!titles.includes(gone), `${subflow} still takes ${gone}`);
      assert.ok(!start.metadata.cinatra.hidden.includes(gone), `${subflow} still hides ${gone}`);
    }
  });
}

test("#3035: each embedded agent still runs start, brand voice, its own step, end", () => {
  for (const [subflow, short, work] of [
    [WRITER, "blog-draft-writer-agent", "write"],
    [IMAGE, "blog-image-generator-agent", "generate"],
  ]) {
    const def = refs[subflow];
    const edges = def.control_flow_connections.map(
      (e) => `${e.from_node.$component_ref}>${e.to_node.$component_ref}`,
    );
    assert.deepEqual(edges.sort(), [
      `${short}__${work}>${short}__end`,
      `${short}__read_brand_voice>${short}__${work}`,
      `${short}__start>${short}__read_brand_voice`,
    ].sort());
    const nodes = def.nodes.map((n) => n.$component_ref).sort();
    assert.deepEqual(nodes, [
      `${short}__end`,
      `${short}__read_brand_voice`,
      `${short}__start`,
      `${short}__${work}`,
    ].sort());
    const listed = Object.keys(def.$referenced_components).sort();
    assert.deepEqual(listed, nodes, `${subflow} still lists components no node runs`);
  }
});
