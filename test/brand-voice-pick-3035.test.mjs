// The one brand-voice pick of cinatra-ai/cinatra#3035, as cinatra-ai/cinatra#4314
// decides it: the brand-voice pause is a declared list step over the
// organisation's stored brand-voice artifacts; it takes exactly one pick, the
// pick is required and nothing is chosen in advance; and that one pick fills the
// brand-voice slot of every embedded step that declares one, the draft writer
// first among them.
//
// The pause is the flow's declared context slot. The host draws it ("A gate
// that offers a list, not a field") and hands its finalized pick down through
// the flow's parent-satisfied lines. The host does so only when two of its own
// checks pass, mirrored below in the host's terms:
//
//   - the install check (cinatra `src/lib/extension-host-compat.ts`,
//     `checkOneCarrier`): the parent's slot accepts every kind the child's slot
//     accepts, its bounds sit inside the child's, the resolution modes match, a
//     read-only child gets a read-only parent;
//   - the loader (cinatra `docker/wayflow/context_subflow_injection.py`): every
//     line names an embedded definition that declares the child slot under its
//     package, the child carries no author-placed subflow for that slot (or its
//     own pause would still fire), exactly one node runs that child, and the
//     parent's own slot has a consumer in the parent's graph.
//
// On the pin 19cb2cd1f9f6 the pause was an optional free-text field
// (`brand_voice_gate.brandVoice`) wired into the writer's `voice`, so every case
// below fails there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components;
const cin = oas.metadata.cinatra;

const BRAND_VOICE = "@cinatra-ai/brand-voice-artifact";
const WRITER = "@cinatra-ai/blog-draft-writer-agent";
const IMAGE = "@cinatra-ai/blog-image-generator-agent";

const slots = () => cin.contextSlots ?? [];
const lines = () => cin.parentSatisfiedContextSlots ?? [];
const pick = () => slots().find((s) => s.slotId === "brandVoice");

/** Every embedded agent definition that declares slots, by package. */
function embedded() {
  return Object.values(refs).filter(
    (c) => c?.component_type === "Flow" && Array.isArray(c?.metadata?.cinatra?.contextSlots),
  );
}

function installConflicts(parent, child) {
  const conflicts = [];
  const accepted = new Set(parent.acceptedArtifactExtensions);
  const unaccepted = child.acceptedArtifactExtensions.filter((e) => !accepted.has(e));
  if (unaccepted.length > 0) conflicts.push(`the child accepts ${unaccepted.join(", ")}`);
  const bounds = (s) => ({ min: s.minItems ?? 0, max: s.maxItems ?? Infinity });
  const p = bounds(parent);
  const c = bounds(child);
  if (p.min < c.min || p.max > c.max) conflicts.push("the pick falls outside the child's bounds");
  if (parent.resolutionMode !== child.resolutionMode) conflicts.push("the resolution modes differ");
  if (child.readableOnly === true && parent.readableOnly !== true) conflicts.push("read-only slot");
  return conflicts;
}

test("#3035 brand-voice pick: the pause is a declared list step over stored brand-voice artifacts", () => {
  const slot = pick();
  assert.ok(slot, "the flow declares no brand-voice slot");
  assert.deepEqual(slot.acceptedArtifactExtensions, [BRAND_VOICE], "the list holds brand-voice artifacts only");
  assert.equal(refs.brand_voice_gate, undefined, "the free-text pause brand_voice_gate is still in the flow");
  const freeText = Object.entries(refs).filter(
    ([, c]) => c?.metadata?.cinatra?.inputMessageSchema?.properties?.brandVoice !== undefined,
  );
  assert.deepEqual(freeText.map(([id]) => id), [], "a free-text brandVoice field is left");
  assert.ok(
    cin.hitlScreens.includes("@cinatra-ai/context-selection-agent:context-selector"),
    "the flow names the screen the host draws the list step with",
  );
});

test("#3035 brand-voice pick: exactly one pick, required, nothing chosen in advance", () => {
  const slot = pick();
  assert.ok(slot, "the flow declares no brand-voice slot");
  assert.equal(slot.resolutionMode, "override", "one brand voice, never a stack of them");
  assert.equal(slot.minItems, 1, "the pick is required: Continue waits for it");
  assert.equal(slot.maxItems, 1, "exactly one pick");
  // An autonomous slot is settled by the runtime; an interactive one waits for
  // a person, with no row chosen for them.
  assert.equal(slot.selectionMode, "interactive");
});

test("#3035 brand-voice pick: the pick satisfies the brand-voice slot of every embedded step that declares one", () => {
  const slot = pick();
  assert.ok(slot, "the flow declares no brand-voice slot");
  const withBrandVoice = embedded().flatMap((def) =>
    def.metadata.cinatra.contextSlots
      .filter((s) => s.acceptedArtifactExtensions.includes(BRAND_VOICE))
      .map((s) => ({ def, slot: s })),
  );
  const packages = withBrandVoice.map(({ def }) => def.metadata.cinatra.packageName).sort();
  assert.ok(packages.includes(WRITER), "the draft step declares no brand-voice slot");
  assert.ok(packages.includes(IMAGE), "the featured-image step declares no brand-voice slot");
  for (const { def, slot: child } of withBrandVoice) {
    const pkg = def.metadata.cinatra.packageName;
    const line = lines().find((l) => l.childPackage === pkg && l.childSlotId === child.slotId);
    assert.ok(line, `${pkg} slot ${child.slotId} is not satisfied by the pipeline's pick`);
    assert.equal(line.parentSlotId, "brandVoice");
    assert.deepEqual(installConflicts(slot, child), [], `the host's install check refuses ${pkg}`);
    // The loader hands a pick only to a slot the child does not resolve itself.
    const marker = Object.values(def.$referenced_components).filter(
      (c) => c?.metadata?.cinatra?.purpose?.endsWith(`-context-resolution-for-${child.slotId}`),
    );
    assert.deepEqual(marker.map((c) => c.id), [], `${pkg} still pauses for ${child.slotId} itself`);
    // Exactly one node of the pipeline runs that child.
    const holders = Object.values(refs).filter((c) => c?.subflow?.$component_ref === def.id);
    assert.equal(holders.length, 1, `${pkg} is run by ${holders.length} nodes`);
    // The child's own step takes the pick by the slot's input name.
    const takes = Object.values(def.$referenced_components).some((c) =>
      (c?.inputs ?? []).some((i) => i.title === `${child.slotId}ContextSlotBindings`),
    );
    assert.ok(takes, `no step of ${pkg} takes ${child.slotId}ContextSlotBindings`);
    // The host hands the pick down on a start-node input typed string
    // (`_ensure_input` in the loader), and the typed graph refuses an edge from a
    // string into an array. The pick names a stored artifact and carries none of
    // its text, so the one step of the child that takes it is the child's read
    // step: it takes the pick as text and reads the brand voice's text through
    // the tool `brand_voice_text`, which this pack declares too, because the host
    // resolves a tool against the pack whose run calls it.
    const short = pkg.split("/")[1];
    const takers = Object.entries(def.$referenced_components)
      .filter(([, c]) => (c?.inputs ?? []).some((i) => i.title === `${child.slotId}ContextSlotBindings`))
      .map(([id]) => id);
    assert.deepEqual(takers, [`${short}__read_brand_voice`], `${pkg}: only its read step takes the pick`);
    const read = def.$referenced_components[`${short}__read_brand_voice`];
    assert.deepEqual(
      read.inputs.filter((i) => i.title === `${child.slotId}ContextSlotBindings`).map((i) => i.type),
      ["string"],
      `${pkg} takes ${child.slotId}ContextSlotBindings as text`,
    );
    assert.equal(read.data.tool, "extension_tool");
    assert.equal(read.data.input.name, "brand_voice_text");
    // The child's work step writes from the text the read step gives.
    const textEdges = def.data_flow_connections.filter(
      (e) => e.source_node.$component_ref === `${short}__read_brand_voice` && e.source_output === "brandVoiceText",
    );
    assert.equal(textEdges.length, 1, `${pkg}: the brand voice's text reaches one step`);
  }
  for (const line of lines()) {
    assert.ok(
      withBrandVoice.some(
        ({ def, slot: s }) => def.metadata.cinatra.packageName === line.childPackage && s.slotId === line.childSlotId,
      ),
      `the line for ${line.childPackage} ${line.childSlotId} names no embedded slot`,
    );
  }
});

test("#3035 brand-voice pick: the draft step no longer receives a voice string from the pause", () => {
  const fed = oas.data_flow_connections.filter(
    (e) => e.destination_node.$component_ref === "draft_flow" && e.destination_input === "voice",
  );
  assert.deepEqual(fed.map((e) => e.source_node.$component_ref), []);
});

test("#3035 brand-voice pick: the pipeline's own graph takes its pick, so the host mounts the slot", () => {
  // The loader refuses a declared slot that no step of the flow's own graph
  // takes. This flow's own read step takes the pick, right after the start, and
  // reads its text through the declared tool, so a brand voice that cannot be
  // read (a PDF) stops the run before any idea is taken or any draft is written.
  const own = new Set(oas.nodes.map((n) => n.$component_ref));
  const consumers = Object.entries(refs).filter(
    ([id, c]) =>
      own.has(id) &&
      c?.component_type !== "Flow" &&
      (c?.inputs ?? []).some((i) => i.title === "contextSlotBindings" || i.title === "brandVoiceContextSlotBindings"),
  );
  assert.deepEqual(consumers.map(([id]) => id), ["read_brand_voice"]);
  const read = refs.read_brand_voice;
  const input = read.inputs.find((i) => i.title === "brandVoiceContextSlotBindings");
  assert.equal(input.type, "array", "in its own graph the flow takes the pick as the list itself");
  assert.equal(read.data.tool, "extension_tool");
  assert.equal(read.data.input.name, "brand_voice_text");
  assert.equal(
    read.data.input.input.bindings,
    "{# pyagentspec-input-hint (do not remove): {{ brandVoiceContextSlotBindings }} #}{{ brandVoiceContextSlotBindings | tojson }}",
  );
  assert.equal(read.data.agent_run_id, "{{ cinatra_run_id }}");
});

test("#3035 brand-voice pick: the run reports no binding of the pick", () => {
  // The binding names stored artifacts, revisions and scopes: backend detail a
  // person has no use for. No output of the run carries it.
  assert.deepEqual(oas.outputs.map((o) => o.title).sort(), ["linkedinPost", "linkedinTitle"]);
  assert.deepEqual(refs.end.outputs.map((o) => o.title).sort(), ["linkedinPost", "linkedinTitle"]);
  assert.ok(
    !(refs.end.inputs ?? []).some((i) => /ContextSlotBindings$|^contextSlotBindings$/.test(i.title)),
    "the end node takes no binding",
  );
});
