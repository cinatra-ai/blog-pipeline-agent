// THE FEATURED IMAGE IS FILED, AND THE REVIEW NAMES IT AFTER THE POST —
// cinatra#3035.
//
// These cases pin five things on the flow definition and the manifest: one step
// of the run files the featured image through the host's image tool as a blog
// image; it runs after the picture is settled and before the review; it carries
// the picture's prompt, the post it belongs to, its placement and its
// alternative text; the review's target set names the post first and the
// picture second; and the blog image is a declared production of both the
// manifest and the flow.
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

const PASSTHROUGH_URL = "{{CINATRA_BASE_URL}}/api/agents/passthrough";
const IMAGE_TOOL = "artifact_image_generate";
const POST = {
  extension: "@cinatra-ai/blog-post-artifact",
  objectTypeId: "@cinatra-ai/blog-post-artifact:post",
};
const IMAGE = {
  extension: "@cinatra-ai/blog-image-artifact",
  objectTypeId: "@cinatra-ai/blog-image-artifact:blog-image",
};
const LINKEDIN = {
  extension: "@cinatra-ai/linkedin-artifacts",
  objectTypeId: "@cinatra-ai/linkedin:post-draft",
};

const ownNodes = () =>
  oas.nodes
    .map((n) => n.$component_ref)
    .filter((id) => parts[id] && parts[id].component_type);

/** The pipeline's own steps that call the host's image tool. */
const imageToolSteps = () =>
  ownNodes().filter((id) => {
    const node = parts[id];
    return node.component_type === "ApiNode" && node.data && node.data.tool === IMAGE_TOOL;
  });

/** The one step that files the featured image; fails when there is not exactly one. */
const filingStep = () => {
  const found = imageToolSteps();
  assert.equal(found.length, 1, "exactly one step of the run files the featured image");
  return found[0];
};

const edgeInto = (node, input) =>
  oas.data_flow_connections.find(
    (e) => e.destination_node.$component_ref === node && e.destination_input === input,
  );

const assertSourced = (node, input, fromNode, fromOutput) => {
  const edge = edgeInto(node, input);
  assert.ok(edge, `${node}.${input} is edge-sourced`);
  assert.equal(edge.source_node.$component_ref, fromNode, `${node}.${input} comes from ${fromNode}`);
  assert.equal(edge.source_output, fromOutput, `${node}.${input} reads ${fromNode}'s ${fromOutput}`);
};

/** Every road of control edges from the start node to an end node. */
function roads() {
  const next = new Map();
  for (const edge of oas.control_flow_connections) {
    const from = edge.from_node.$component_ref;
    if (!next.has(from)) next.set(from, []);
    next.get(from).push(edge.to_node.$component_ref);
  }
  const ends = ownNodes().filter((id) => parts[id].component_type === "EndNode");
  const found = [];
  const walk = (id, road) => {
    if (road.includes(id)) return;
    const here = [...road, id];
    if (ends.includes(id)) {
      found.push(here);
      return;
    }
    for (const to of next.get(id) ?? []) walk(to, here);
  };
  walk(oas.start_node.$component_ref, []);
  return found;
}

/** A template with its comment sentinels removed: what the step really sends. */
const withoutComments = (text) => text.replace(/\{#[^#]*#\}/g, "");

test("the run files its featured image through the host's image tool", () => {
  const id = filingStep();
  const node = parts[id];
  assert.equal(node.url, PASSTHROUGH_URL, "the step calls the host's passthrough");
  assert.equal(node.http_method, "POST");
  assert.equal(node.data.input.extension, IMAGE.extension, "it files a blog image");
  assert.equal(node.data.input.objectTypeId, IMAGE.objectTypeId, "of the blog image type");
  assert.equal(node.data.input.node_id, id, "the call names the step that makes it");
  assert.equal(node.metadata.cinatra.riskClass, "write", "filing a picture is a write");
});

test("the picture is filed after it is settled and before the review", () => {
  const id = filingStep();
  const found = roads();
  assert.ok(found.length > 0, "at least one road reaches the end");
  for (const road of found) {
    const order = ["image_flow", id, "complete_relation", "draft_review_gate"].map((step) =>
      road.indexOf(step),
    );
    for (const [i, at] of order.entries()) {
      assert.notEqual(at, -1, `the road ${road.join("->")} skips step ${i + 1} of the four`);
    }
    assert.ok(order[0] < order[1], "the picture is settled before it is filed");
    assert.ok(order[1] < order[2], "it is filed before the review's target set is gathered");
    assert.ok(order[2] < order[3], "and the set is gathered before the review");
  }
});

test("the picture carries its prompt, the post it belongs to, its placement and its alternative text", () => {
  const id = filingStep();
  const input = parts[id].data.input;
  assertSourced(id, "image", "image_flow", "image");
  assertSourced(id, "postArtifactId", "write_draft", "artifactId");
  assertSourced(id, "title", "draft_flow", "title");
  assert.equal(input.title.trim(), "{{ title }}", "the picture is named after the post");
  assert.match(
    withoutComments(input.prompt),
    /^\{\{\s*image\.prompt\s*\}\}$/,
    "the prompt is the one the step before settled",
  );
  assert.equal(typeof input.dataJson, "string", "the picture's own data travels as a JSON string");
  // Render the template the way the run does, with each value replaced by a JSON
  // string, then PARSE it — a regex over field names would pass on invalid JSON.
  const rendered = withoutComments(input.dataJson).replace(
    /\{\{\s*([A-Za-z0-9_.]+)\s*\|\s*tojson\s*\}\}/g,
    (_m, name) => JSON.stringify(`RENDERED-${name}`),
  );
  const data = JSON.parse(rendered);
  assert.equal(typeof data, "object");
  assert.ok(data !== null && !Array.isArray(data), "the picture's data is one object");
  assert.deepEqual(Object.keys(data).sort(), ["altText", "placement", "post"]);
  assert.equal(data.placement, "featured");
  assert.equal(data.post, "RENDERED-postArtifactId", "the post it belongs to");
  assert.equal(data.altText, "RENDERED-image.altText", "the alternative text the step before settled");
});

test("the review names the post first and the picture second", () => {
  const id = filingStep();
  const gate = parts.draft_review_gate;
  const named = gate.metadata.cinatra.artifactReview.targetsInput;
  const projection = edgeInto("draft_review_gate", named).source_node.$component_ref;
  const template = parts[projection].data.input.input[named];
  assert.equal(typeof template, "string", "one JSON array string, which is what is parsed");
  const rendered = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name) => `RENDERED-${name}`);
  const targets = JSON.parse(rendered);
  assert.ok(Array.isArray(targets), "a JSON array of references");
  assert.equal(targets.length, 2, "exactly two references: the post and its picture");
  for (const target of targets) {
    assert.deepEqual(Object.keys(target).sort(), ["artifactId", "representationRevisionId"]);
  }
  const [post, picture] = targets;
  const postIdInput = post.artifactId.replace(/^RENDERED-/, "");
  const postRevInput = post.representationRevisionId.replace(/^RENDERED-/, "");
  const pictureIdInput = picture.artifactId.replace(/^RENDERED-/, "");
  const pictureRevInput = picture.representationRevisionId.replace(/^RENDERED-/, "");
  assertSourced(projection, postIdInput, "write_draft", "artifactId");
  assertSourced(projection, postRevInput, "write_draft", "representationRevisionId");
  assertSourced(projection, pictureIdInput, id, "artifactId");
  assertSourced(projection, pictureRevInput, id, "representationRevisionId");
});

test("the picture is a declared production of the manifest and of the flow", () => {
  const expected = [POST, IMAGE, LINKEDIN];
  assert.deepEqual(manifest.cinatra.produces, expected, "the manifest declares it between the post and the LinkedIn post");
  assert.deepEqual(oas.metadata.cinatra.produces, expected, "and so does the flow");
});
