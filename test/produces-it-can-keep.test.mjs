// A produces entry is a promise the run keeps. The pipeline files its draft and
// its LinkedIn post through terminal bindings, so it declares those two. Its
// ideas and its pictures are written mid-run, and that road is not built yet —
// declaring them now would be a promise nothing keeps, and the fleet's adoption
// gate refuses exactly that (a declared production with no materialization).
// The two entries return with their write roads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const KEPT = [
  {
    extension: "@cinatra-ai/blog-post-artifact",
    objectTypeId: "@cinatra-ai/blog-post-artifact:post",
  },
  {
    extension: "@cinatra-ai/linkedin-artifacts",
    objectTypeId: "@cinatra-ai/linkedin:post-draft",
  },
];

test("it declares exactly the two productions it materializes today", () => {
  assert.deepEqual(manifest.cinatra.produces, KEPT);
  assert.deepEqual(oas.metadata.cinatra.produces, KEPT);
});

// A production is kept one of two ways: a terminal binding at the end node, or a
// write the run makes while it is still going. The LinkedIn post is bound at the
// end; the blog post is written mid-run, before the review that reads it.
test("every declared production has a road that keeps it", () => {
  const bound = oas.$referenced_components.end.outputs
    .filter((o) => o.cinatra && o.cinatra.artifact)
    .map((o) => o.cinatra.artifact.extension);
  const written = Object.values(oas.$referenced_components)
    .filter(
      (n) => n && n.component_type === "ApiNode" && n.data && n.data.tool === "artifact_materialize",
    )
    .map((n) => n.data.input.extension);
  assert.deepEqual(bound, ["@cinatra-ai/linkedin-artifacts"]);
  assert.deepEqual(written, ["@cinatra-ai/blog-post-artifact"]);
  assert.deepEqual(
    [...bound, ...written].sort(),
    KEPT.map((p) => p.extension).sort(),
  );
});

test("the four dependency edges stay — they say what the run touches", () => {
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
