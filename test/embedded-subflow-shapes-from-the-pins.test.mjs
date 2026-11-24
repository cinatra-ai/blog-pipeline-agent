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

test("#3033: every agent edge's range admits the child version the run embeds", () => {
  // The host refuses an embedded child's tool call (edge-constraint-unmet) when
  // the parent's declared range does not include the installed child's version.
  // `^0.1.0` admitted none of the draft writer 0.2.x, the idea generator 0.2.x or
  // the LinkedIn writer 0.2.x. The draft writer 0.2.2 and the image generator
  // 0.1.4 are the first versions that declare `brand_voice_text` embeddable,
  // which the embedded `read_brand_voice` steps call.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const ranges = Object.fromEntries(
    pkg.cinatra.dependencies
      .filter((d) => d.kind === "agent")
      .map((d) => [d.packageName, d.versionConstraint]),
  );
  const caret = (range) => ({ kind: "semver-range", range });
  assert.deepEqual(ranges, {
    "@cinatra-ai/blog-draft-writer-agent": caret("^0.2.2"),
    "@cinatra-ai/blog-idea-generator-agent": caret("^0.2.0"),
    "@cinatra-ai/blog-image-generator-agent": caret("^0.1.4"),
    "@cinatra-ai/blog-linkedin-writer-agent": caret("^0.2.0"),
    "@cinatra-ai/context-selection-agent": caret("^0.1.1"),
  });
});

// The host checks an edge with `semver.satisfies(version, range,
// { includePrerelease: true })` (cinatra packages/registries/src/version-compare.ts
// `satisfiesVersionRange`). This pack has no semver dependency, so this is that
// rule for the only form its edges use: a caret range over a plain X.Y.Z
// version. `^0.0.z` admits only 0.0.z, `^0.y.z` admits >=0.y.z <0.(y+1).0, and
// `^x.y.z` (x >= 1) admits >=x.y.z <(x+1).0.0. Anything else is refused here,
// so a new range form fails this test instead of being misread.
const PLAIN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function caretSatisfies(version, range) {
  const v = PLAIN.exec(version);
  const r = range.startsWith("^") ? PLAIN.exec(range.slice(1)) : null;
  if (!v || !r) throw new Error(`unsupported version ${version} or range ${range}`);
  const [vx, vy, vz] = v.slice(1).map(Number);
  const [rx, ry, rz] = r.slice(1).map(Number);
  const below = vx - rx || vy - ry || vz - rz;
  if (below < 0) return false;
  if (rx > 0) return vx === rx;
  if (ry > 0) return vx === 0 && vy === ry;
  return vx === 0 && vy === 0 && vz === rz;
}

test("the caret rule matches semver's on the cases that matter here", () => {
  assert.equal(caretSatisfies("0.1.0", "^0.2.0"), false);
  assert.equal(caretSatisfies("0.2.0", "^0.2.0"), true);
  assert.equal(caretSatisfies("0.2.9", "^0.2.0"), true);
  assert.equal(caretSatisfies("0.3.0", "^0.2.0"), false);
  assert.equal(caretSatisfies("0.2.1", "^0.2.2"), false);
  assert.equal(caretSatisfies("0.0.3", "^0.0.3"), true);
  assert.equal(caretSatisfies("0.0.4", "^0.0.3"), false);
  assert.equal(caretSatisfies("1.4.0", "^1.2.0"), true);
  assert.equal(caretSatisfies("2.0.0", "^1.2.0"), false);
});

test("#3033: every embedded child declares a version its agent edge admits", () => {
  // The finding on #89: the LinkedIn edge was widened to ^0.2.0 while the
  // embedded LinkedIn flow still declared 0.1.0, a version outside the range.
  // Every embedded child flow must name its package, be an agent edge of this
  // pack, and declare the version it was copied from, inside that edge's range.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const edges = new Map(
    pkg.cinatra.dependencies
      .filter((d) => d.kind === "agent")
      .map((d) => [d.packageName, d.versionConstraint]),
  );
  const embedded = Object.values(components).filter(
    (c) => c.component_type === "Flow" && c.metadata?.cinatra?.packageName,
  );
  assert.deepEqual(
    embedded.map((c) => c.id).sort(),
    [
      "blog-draft-writer-agent-subflow",
      "blog-image-generator-agent-subflow",
      "blog-linkedin-writer-agent-subflow",
    ],
  );
  for (const flow of embedded) {
    const { packageName, packageVersion } = flow.metadata.cinatra;
    const edge = edges.get(packageName);
    assert.ok(edge, `${flow.id} embeds ${packageName}, which is not an agent edge`);
    assert.equal(edge.kind, "semver-range", `${packageName}: edge is not a semver range`);
    assert.equal(typeof packageVersion, "string", `${flow.id} declares no packageVersion`);
    assert.ok(
      caretSatisfies(packageVersion, edge.range),
      `${flow.id} declares ${packageVersion}, outside its edge's range ${edge.range}`,
    );
  }
});

test("#3033: the embedded LinkedIn writer step carries its 0.2.0 pin's node", () => {
  // The step is a verbatim copy of the child's `write` node at 0.2.0
  // (blog-linkedin-writer-agent ce519f59), apart from its prefixed id. That
  // node has no SKILL.md any more: its instructions are inline and it joins
  // no toolbox.
  const sub = components["blog-linkedin-writer-agent-subflow"];
  const write = sub.$referenced_components["blog-linkedin-writer-agent__write"];
  assert.ok(write, "the embedded LinkedIn writer has no write step");
  assert.deepEqual(write.data.toolbox_ids, []);
  assert.deepEqual(
    everyText(write).filter((t) => t.includes("SKILL.md")).map(shorten),
    [],
    "the embedded LinkedIn writer still carries its 0.1.0 SKILL.md prompt",
  );
  assert.ok(
    write.data.system.startsWith(
      "You are a stateless blog LinkedIn writer agent. No toolbox joins this turn:",
    ),
    "the embedded LinkedIn writer's prompt is not its 0.2.0 pin's",
  );
});
