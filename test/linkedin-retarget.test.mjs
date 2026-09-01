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

test("the blog-post binding still reads the draft's own title", () => {
  assert.equal(out("draft").cinatra.artifact.titleFrom, "draftTitle");
  assert.equal(
    out("draft").cinatra.artifact.objectTypeId,
    "@cinatra-ai/blog-post-artifact:post",
  );
});

test("the ideas the pipeline carries declare their member level as plain strings", () => {
  assert.deepEqual(out("ideas").json_schema.items, { type: "string" });
});

test("the four produces entries are typed", () => {
  assert.deepEqual(manifest.cinatra.produces, [
    {
      extension: "@cinatra-ai/blog-idea-artifact",
      objectTypeId: "@cinatra-ai/blog-idea-artifact:blog-idea",
    },
    {
      extension: "@cinatra-ai/blog-post-artifact",
      objectTypeId: "@cinatra-ai/blog-post-artifact:post",
    },
    {
      extension: "@cinatra-ai/blog-image-artifact",
      objectTypeId: "@cinatra-ai/blog-image-artifact:blog-image",
    },
    {
      extension: "@cinatra-ai/linkedin-artifacts",
      objectTypeId: "@cinatra-ai/linkedin:post-draft",
    },
  ]);
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
