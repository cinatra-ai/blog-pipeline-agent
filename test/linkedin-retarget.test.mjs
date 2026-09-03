// Pins the pipeline's terminal LinkedIn binding on the LINKEDIN type. Before
// this conversion `linkedinPost` was bound to the blog-post extension, so the
// pipeline filed its LinkedIn copy as a second blog post — the one mis-targeted
// binding the plan names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const end = oas.$referenced_components.end;
const out = (t) => end.outputs.find((o) => o.title === t);

test("linkedinPost is bound to the LinkedIn post-draft type", () => {
  assert.deepEqual(out("linkedinPost").cinatra.artifact, {
    extension: "@cinatra-ai/linkedin-artifacts",
    objectTypeId: "@cinatra-ai/linkedin:post-draft",
    contentFrom: "linkedinPost",
    declaredMime: "text/plain",
    titleFrom: "linkedinTitle",
  });
});

test("the LinkedIn binding reads a LinkedIn title, not the blog draft's", () => {
  const titles = end.outputs.map((o) => o.title);
  assert.ok(titles.includes("linkedinTitle"));
  assert.ok(
    oas.data_flow_connections.some((e) => e.destination_input === "linkedinTitle"),
    "the LinkedIn title must be edge-sourced from the LinkedIn writer",
  );
});

// The draft used to be bound at the end node, which meant it existed only once
// the run was over — after the review that was supposed to read it. It is now
// written while the run is going, and the end node binds it no more.
test("the draft is not bound at the end node — it is written while the run runs", () => {
  assert.equal(out("draft"), undefined);
  const write = Object.values(oas.$referenced_components).find(
    (n) => n && n.component_type === "ApiNode" && n.data && n.data.tool === "artifact_materialize",
  );
  assert.ok(write, "the mid-run write is what keeps the blog-post production");
  assert.equal(write.data.input.objectTypeId, "@cinatra-ai/blog-post-artifact:post");
  assert.equal(write.data.input.declaredMime, "text/markdown");
});

// The ideas the run offers are references a person picks from, not a bound
// output, so what has to be declared is the reference each entry carries.
test("the ideas the gate offers declare the reference a pick commits", () => {
  const gate = oas.$referenced_components.idea_selection_gate;
  const ideas = gate.inputs.find((i) => i.title === "ideas");
  assert.deepEqual(ideas.json_schema.items, { type: "object" });
  assert.match(
    JSON.stringify(gate.metadata.cinatra.description),
    /artifact and the exact revision/,
  );
});

// The produces entries this run keeps today live in produces-it-can-keep.test.mjs:
// the ideas and the pictures return with their mid-run write roads.
test("every produces entry is typed", () => {
  for (const entry of manifest.cinatra.produces) {
    assert.match(entry.objectTypeId, /^@[\w-]+\/[\w-]+:[\w-]+$/);
  }
});

test("the four artifact dependency edges are declared", () => {
  const names = (manifest.cinatra.dependencies || [])
    .filter((d) => d.kind === "artifact")
    .map((d) => d.packageName)
    .sort();
  assert.deepEqual(names, [
    "@cinatra-ai/blog-idea-artifact",
    "@cinatra-ai/blog-image-artifact",
    "@cinatra-ai/blog-post-artifact",
    "@cinatra-ai/linkedin-artifacts",
  ]);
});
