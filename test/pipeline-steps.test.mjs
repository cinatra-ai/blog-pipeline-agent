// THE PIPELINE'S STEPS — plan (C) section 6.1, the walk a person makes.
//
// Every case below pins one sentence of that walk onto the flow definition, in
// the order the walk happens: the stored ideas offered as a real list, the pick
// that is its own reservation, the draft written while the run is still going,
// the picture made before anyone reviews anything, the review opened on what the
// run made, the LinkedIn post at the end, and the pauses the pipeline really has.
//
// Read the flow, never a copy of it: the file this suite reads is the file the
// platform runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const parts = oas.$referenced_components;

const IDEA_TYPE = "@cinatra-ai/blog-idea-artifact:blog-idea";

/** Every node of the pipeline's OWN graph, in control-flow order from the start. */
function walkOrder() {
  const next = new Map();
  for (const edge of oas.control_flow_connections) {
    const from = edge.from_node.$component_ref;
    if (!next.has(from)) next.set(from, []);
    next.get(from).push(edge.to_node.$component_ref);
  }
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const to of next.get(id) ?? []) visit(to);
  };
  visit(oas.start_node.$component_ref);
  return order;
}

const order = walkOrder();
const at = (id) => {
  const i = order.indexOf(id);
  assert.notEqual(i, -1, `the flow has no node "${id}"`);
  return i;
};
const ownNodes = () =>
  oas.nodes
    .map((n) => n.$component_ref)
    .filter((id) => parts[id] && parts[id].component_type);
const nodesOfType = (type) => ownNodes().filter((id) => parts[id].component_type === type);
const toolNodes = (tool, op) =>
  ownNodes().filter((id) => {
    const node = parts[id];
    if (node.component_type !== "ApiNode") return false;
    if (!node.data || node.data.tool !== tool) return false;
    return op === undefined || (node.data.input && node.data.input.op === op);
  });
const edgeInto = (node, input) =>
  oas.data_flow_connections.find(
    (e) => e.destination_node.$component_ref === node && e.destination_input === input,
  );

// ---------------------------------------------------------------------------
// 1. "A list of the organisation's blog ideas no draft has used." (6.1 step 2)
// ---------------------------------------------------------------------------

test("a preparation step reads the organisation's stored ideas in front of the gate", () => {
  const prepare = toolNodes("blog_pipeline_ideas", "prepare");
  assert.equal(prepare.length, 1, "exactly one preparation step lists the stored ideas");
  const node = parts[prepare[0]];
  assert.equal(
    node.data.input.ideaType,
    IDEA_TYPE,
    "the preparation step names the idea type the pipeline declares as a dependency",
  );
  assert.ok(at(prepare[0]) < at("idea_selection_gate"), "it runs before the gate");
});

test("the gate offers that list, not a free-text field and not an in-run batch", () => {
  const prepare = toolNodes("blog_pipeline_ideas", "prepare")[0];
  const gate = parts.idea_selection_gate;
  const declared = (gate.inputs ?? []).map((i) => i.title);
  assert.ok(declared.includes("ideas"), "the gate declares the offered ideas as a render input");
  assert.ok(declared.includes("reason"), "and the sentence an empty list ends the run with");
  for (const name of ["ideas", "reason"]) {
    const edge = edgeInto("idea_selection_gate", name);
    assert.ok(edge, `${name} must be edge-sourced into the gate`);
    assert.equal(
      edge.source_node.$component_ref,
      prepare,
      `${name} must come from the preparation step`,
    );
  }
  assert.ok(
    !ownNodes().some((id) => (parts[id].metadata?.cinatra?.packageName ?? "") === "@cinatra-ai/blog-idea-generator-agent"),
    "the in-run batch the gate used to offer is gone",
  );
});

// ---------------------------------------------------------------------------
// 2. "The pick is the reservation." (5.1; the selected-idea save retires)
// ---------------------------------------------------------------------------

test("nothing saves a selected idea any more", () => {
  const saves = ownNodes().filter(
    (id) => parts[id].component_type === "ApiNode" && parts[id].data?.tool === "objects_save",
  );
  assert.deepEqual(saves, [], "the selected-idea save and the draft projection save are retired");
  assert.ok(
    !JSON.stringify(oas).includes("blog_pipeline_selected_idea"),
    "the retired save's shape name occurs nowhere in the flow",
  );
});

test("the pick is reserved, and the reserved idea's own words are what the draft is written from", () => {
  const reserve = toolNodes("blog_pipeline_ideas", "reserve");
  assert.equal(reserve.length, 1, "exactly one step takes the picked idea");
  const node = parts[reserve[0]];
  assert.ok(at("idea_selection_gate") < at(reserve[0]), "it runs after the pick");
  assert.equal(
    edgeInto(reserve[0], "selectedIdeaJson").source_node.$component_ref,
    "idea_selection_gate",
    "the pick it validates is the one the person made",
  );
  const draftIdea = edgeInto("draft_flow", "idea");
  assert.equal(draftIdea.source_node.$component_ref, reserve[0]);
  assert.equal(draftIdea.source_output, "idea");
  // Fail closed: a refused pick — an empty list, or an idea another run just
  // took — leaves these outputs unanswered, and a step output with no default
  // ends the run instead of drafting an idea nobody chose.
  for (const name of ["idea", "ideaArtifactId", "ideaRevisionId"]) {
    const out = node.outputs.find((o) => o.title === name);
    assert.ok(out, `the reservation returns ${name}`);
    assert.ok(!("default" in out), `${name} carries no default that would paper over a refusal`);
  }
});

// ---------------------------------------------------------------------------
// 3. "The pipeline writes the draft mid-run." (6.1 step 3, 8.4)
// ---------------------------------------------------------------------------

test("the draft is written while the run is still going, as a blog-post artifact", () => {
  const writes = toolNodes("artifact_materialize");
  assert.equal(writes.length, 1, "one mid-run write, and it is the draft's");
  const node = parts[writes[0]];
  assert.equal(node.data.input.extension, "@cinatra-ai/blog-post-artifact");
  assert.equal(node.data.input.objectTypeId, "@cinatra-ai/blog-post-artifact:post");
  assert.equal(node.data.input.declaredMime, "text/markdown");
  assert.ok(at("draft_flow") < at(writes[0]), "it writes what the draft writer wrote");
  assert.equal(edgeInto(writes[0], "content").source_node.$component_ref, "draft_flow");
  assert.equal(edgeInto(writes[0], "title").source_node.$component_ref, "draft_flow");
  const returned = node.outputs.map((o) => o.title).sort();
  assert.deepEqual(returned, ["artifactId", "representationRevisionId"]);
});

test("the relation row says which idea this draft came from", () => {
  const complete = toolNodes("blog_pipeline_ideas", "complete");
  assert.equal(complete.length, 1);
  const node = parts[complete[0]];
  const write = toolNodes("artifact_materialize")[0];
  assert.ok(at(write) < at(complete[0]));
  assert.equal(edgeInto(complete[0], "draftArtifactId").source_node.$component_ref, write);
  assert.equal(edgeInto(complete[0], "ideaArtifactId").source_node.$component_ref, toolNodes("blog_pipeline_ideas", "reserve")[0]);
});

// ---------------------------------------------------------------------------
// 4. "Gathered by a projection step into the input the review marker points at."
// ---------------------------------------------------------------------------

test("the review step carries the marker, and the marker names an input the run fills", () => {
  const marker = parts.draft_review_gate.metadata?.cinatra?.artifactReview;
  assert.ok(marker, "the review gate carries the artifact-review marker");
  const named = marker.targetsInput;
  assert.equal(typeof named, "string");
  assert.ok(named.length > 0);
  const declared = (parts.draft_review_gate.inputs ?? []).map((i) => i.title);
  assert.ok(declared.includes(named), `the gate declares the input "${named}" the marker names`);
  const edge = edgeInto("draft_review_gate", named);
  assert.ok(edge, "and the run's own projection fills it");
  const projection = parts[edge.source_node.$component_ref];
  assert.equal(projection.component_type, "ApiNode");
  assert.equal(projection.data.result_input_passthrough, true);
  const targets = JSON.stringify(projection.data.input[named]);
  assert.match(targets, /artifactId/);
  assert.match(targets, /representationRevisionId/);
});

// ---------------------------------------------------------------------------
// 5. "The picture step, before the review." (6.1 step 3, 5.4 P6 item 5)
// ---------------------------------------------------------------------------

test("the picture is made before anyone reviews anything", () => {
  assert.ok(at("draft_flow") < at("image_flow"), "the picture is made from the draft");
  assert.ok(at("image_flow") < at("draft_review_gate"), "and before the review");
  assert.equal(
    parts.image_flow.metadata.cinatra.packageName,
    "@cinatra-ai/blog-image-generator-agent",
    "the retired prompt writer is replaced by the image maker",
  );
  assert.equal(
    edgeInto("image_flow", "postArtifactId").source_node.$component_ref,
    toolNodes("artifact_materialize")[0],
    "the picture is filed against the post the run just wrote",
  );
  assert.ok(
    !JSON.stringify(oas).includes("blog-image-prompt-agent"),
    "nothing in the flow still names the retired prompt writer",
  );
});

// ---------------------------------------------------------------------------
// 6. "The end node binds the LinkedIn post only." (8.4)
// ---------------------------------------------------------------------------

test("the end node binds the LinkedIn post and nothing else", () => {
  const bound = parts.end.outputs.filter((o) => o.cinatra?.artifact).map((o) => o.title);
  assert.deepEqual(bound, ["linkedinPost"]);
  const titles = parts.end.outputs.map((o) => o.title).sort();
  for (const retired of ["draft", "draftTitle", "draftContent", "imagePrompts", "ideas"]) {
    assert.ok(!titles.includes(retired), `${retired} is written during the run, not bound at the end`);
  }
  assert.deepEqual(
    oas.outputs.map((o) => o.title).sort(),
    titles,
    "the flow's outputs are its end node's",
  );
});

// ---------------------------------------------------------------------------
// 7. "The pipeline declares the pauses it really has." (8.4, P6 item 8)
// ---------------------------------------------------------------------------

test("the pipeline has exactly the three pauses of its own that the walk describes", () => {
  assert.deepEqual(nodesOfType("InputMessageNode"), [
    "idea_selection_gate",
    "draft_review_gate",
    "linkedin_review_gate",
  ]);
  for (const id of nodesOfType("InputMessageNode")) {
    assert.equal(parts[id].metadata.cinatra.requiresApproval, true, `${id} is a real pause`);
  }
});

test("each pause is declared where a person reads what the pipeline does", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /pauses three times/i);
  assert.match(manifest.description, /three HITL pauses/i);
  assert.ok(!/imageCount/.test(readme), "the picture count is retired from the contract too");
});

// ---------------------------------------------------------------------------
// 8. "The idea count as a visible input; the picture count is retired."
// ---------------------------------------------------------------------------

test("the person sets how many ideas, and never how many pictures", () => {
  const titles = parts.start.inputs.map((i) => i.title);
  assert.ok(titles.includes("ideaCount"));
  assert.ok(!titles.includes("imageCount"), "one picture, the featured image");
  const hidden = parts.start.metadata.cinatra.hidden;
  assert.ok(!hidden.includes("ideaCount"), "the idea count is a field a person sees");
  assert.ok(edgeInto("idea_selection_gate", "ideaCount"), "and it reaches the gate that uses it");
  assert.deepEqual(
    oas.inputs.map((i) => i.title),
    titles,
    "the flow's inputs are its start node's",
  );
});

// ---------------------------------------------------------------------------
// The table the reservation lives in — the pipeline's own, declared by name.
// ---------------------------------------------------------------------------

test("the pipeline declares the idea-to-draft relation table it writes", () => {
  const tables = manifest.cinatra.declaredTables ?? [];
  const relation = tables.find((t) => t.name === "idea_drafts");
  assert.ok(relation, "the extension-data tool operates only on a declared table");
  assert.equal(relation.organizationColumn, "org_id");
  const columns = relation.columns.map((c) => c.name).sort();
  assert.deepEqual(columns, [
    "created_at",
    "draft_artifact_id",
    "expires_at",
    "idea_artifact_id",
    "idea_revision_id",
    "org_id",
    "run_id",
    "state",
  ]);
  const org = relation.columns.find((c) => c.name === "org_id");
  assert.equal(org.type, "text");
  assert.equal(org.notNull, true);
  const live = (relation.indexes ?? []).find((i) => i.unique);
  assert.ok(live, "one live reservation per idea is a uniqueness rule, not a read");
  assert.deepEqual(live.columns, ["org_id", "idea_artifact_id", "state"]);
});

// ---------------------------------------------------------------------------
// 9. The convergence round's own cases: the roads a person actually walks, and
//    the contracts the platform actually reads. These were added because the
//    cases above proved PLACEMENT and would have stayed green through several
//    real regressions — a pick validated against the wrong list, a completion
//    that never landed, a pause a person cannot leave, a target set that is not
//    the shape the review core parses.
// ---------------------------------------------------------------------------

test("a person offered nothing can still leave the gate, and the run ends with the plain reason", () => {
  // "An empty list ends the run with a plain reason" (6.1 step 2). The reason is
  // drawn at the gate; if the pick were a REQUIRED field the person could read
  // that sentence and never act on it — the run would park at a pause nothing
  // can answer, which is not an ending.
  const schema = parts.idea_selection_gate.metadata.cinatra.inputMessageSchema;
  const required = schema.required ?? [];
  assert.ok(
    !required.includes("selectedIdeaJson"),
    "the pick is not required, so the empty list is a road out and not a dead end",
  );
  const out = parts.idea_selection_gate.outputs.find((o) => o.title === "selectedIdeaJson");
  assert.equal(out.default, "", "an unanswered pick leaves the gate as an empty pick");
  // ...and the step that follows refuses it by name rather than drafting.
  const reserve = toolNodes("blog_pipeline_ideas", "reserve")[0];
  const reason = parts[reserve].outputs.find((o) => o.title === "reason");
  assert.ok(reason, "the refusal carries its own sentence");
  assert.equal(reason.default, "");
});

test("the pick is validated against the very list the person was shown", () => {
  // resolveIdeaPick matches the pick against `offered` and fails closed when the
  // list is empty or does not hold the pick. Feeding it a DIFFERENT list than
  // the gate drew would silently refuse every honest pick.
  const reserve = toolNodes("blog_pipeline_ideas", "reserve")[0];
  const offered = parts[reserve].data.input.offered;
  assert.equal(
    typeof offered,
    "string",
    "the request carries the offered list as one JSON-rendering template",
  );
  assert.match(
    offered,
    /^\{\{\s*ideas\s*\|\s*tojson\s*\}\}$/,
    "and it renders the node's own `ideas` input as JSON text, never a title list",
  );
  const shown = edgeInto("idea_selection_gate", "ideas");
  const validated = edgeInto(reserve, "ideas");
  assert.equal(shown.source_node.$component_ref, validated.source_node.$component_ref);
  assert.equal(shown.source_output, validated.source_output);
});

test("the completion answers with its own ok, so a relation that never landed is visible", () => {
  // The projection rides the call's input echo. The echo REPLACES the tool's own
  // result, so without this the run cannot tell a completed relation from a
  // failed one and reviews a draft whose idea was never marked used.
  const complete = toolNodes("blog_pipeline_ideas", "complete")[0];
  const data = parts[complete].data;
  assert.equal(data.result_input_passthrough, true);
  assert.equal(data.result_id_field, "ok", "the echo carries the call's own ok through");
  const ok = parts[complete].outputs.find((o) => o.title === "ok");
  assert.ok(ok, "and the step declares it");
  assert.equal(ok.type, "boolean");
  assert.equal(ok.default, false, "no answer is not a completion");
});

test("the review's target set is the run's own reference, in the shape the review core parses", () => {
  const gate = parts.draft_review_gate;
  const named = gate.metadata.cinatra.artifactReview.targetsInput;
  const edge = edgeInto("draft_review_gate", named);
  const projection = edge.source_node.$component_ref;
  const template = parts[projection].data.input[named];
  assert.equal(typeof template, "string", "one JSON array string, which is what is parsed");
  // Render it the way the run does, then PARSE it — a regex over field names
  // would pass on a set that is not valid JSON at all.
  const rendered = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name) => `RENDERED-${name}`);
  const targets = JSON.parse(rendered);
  assert.ok(Array.isArray(targets), "a JSON array of references");
  assert.equal(targets.length, 1, "the post today; a picture joins it when one is filed");
  assert.deepEqual(Object.keys(targets[0]).sort(), ["artifactId", "representationRevisionId"]);
  assert.equal(targets[0].artifactId, "RENDERED-draftArtifactId");
  assert.equal(targets[0].representationRevisionId, "RENDERED-draftRevisionId");
  // and both of those are the mid-run write's own outputs, not loose text.
  const write = toolNodes("artifact_materialize")[0];
  const idEdge = edgeInto(projection, "draftArtifactId");
  const revEdge = edgeInto(projection, "draftRevisionId");
  assert.equal(idEdge.source_node.$component_ref, write);
  assert.equal(idEdge.source_output, "artifactId");
  assert.equal(revEdge.source_node.$component_ref, write);
  assert.equal(revEdge.source_output, "representationRevisionId");
});

test("every road from the start to the end passes the three pauses, in the walk's order", () => {
  // Order of DISCOVERY is not order of EXECUTION. A pause reachable on one road
  // and bypassed on another is a pause that does not hold.
  const next = new Map();
  for (const edge of oas.control_flow_connections) {
    const from = edge.from_node.$component_ref;
    if (!next.has(from)) next.set(from, []);
    next.get(from).push(edge.to_node.$component_ref);
  }
  const gates = ["idea_selection_gate", "draft_review_gate", "linkedin_review_gate"];
  const ends = ownNodes().filter((id) => parts[id].component_type === "EndNode");
  assert.ok(ends.length > 0, "the flow ends somewhere");
  const roads = [];
  const walk = (id, road) => {
    if (road.includes(id)) return; // never twice on one road
    const here = [...road, id];
    if (ends.includes(id)) {
      roads.push(here);
      return;
    }
    for (const to of next.get(id) ?? []) walk(to, here);
  };
  walk(oas.start_node.$component_ref, []);
  assert.ok(roads.length > 0, "at least one road reaches the end");
  for (const road of roads) {
    const seen = gates.map((g) => road.indexOf(g));
    for (let i = 0; i < gates.length; i += 1) {
      assert.notEqual(seen[i], -1, `the road ${road.join("->")} skips ${gates[i]}`);
    }
    assert.ok(seen[0] < seen[1], "the idea is chosen before the draft is reviewed");
    assert.ok(seen[1] < seen[2], "the draft is reviewed before the LinkedIn post is approved");
    // the preparation, the write and the picture are on every road too, and in order
    for (const [before, after] of [
      ["prepare_ideas", "idea_selection_gate"],
      ["write_draft", "image_flow"],
      ["image_flow", "draft_review_gate"],
    ]) {
      const i = road.indexOf(before);
      const j = road.indexOf(after);
      assert.notEqual(i, -1, `the road ${road.join("->")} skips ${before}`);
      assert.ok(i < j, `${before} comes before ${after} on every road`);
    }
  }
});

test("the picture files nothing yet, and the review's set says so rather than pretending", () => {
  // The image maker settles the featured image's record; the host tool that
  // files the bytes is not built. This case is the honest statement of that gap
  // AND its tripwire: the moment the picture returns a reference, this goes red
  // and the projection must grow a second entry.
  const image = parts[parts.image_flow.subflow.$component_ref];
  const outputs = (image.outputs ?? []).map((o) => o.title).sort();
  assert.deepEqual(outputs, ["image", "notes"], "the picture answers with its record, not a reference");
  const projection = toolNodes("blog_pipeline_ideas", "complete")[0];
  const feeding = oas.data_flow_connections.filter(
    (e) => e.destination_node.$component_ref === projection,
  );
  assert.ok(
    !feeding.some((e) => e.source_node.$component_ref === "image_flow"),
    "nothing from the picture reaches the review's target set while it files nothing",
  );
});
