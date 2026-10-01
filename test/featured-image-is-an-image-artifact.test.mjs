// THE FEATURED IMAGE IS AN IMAGE ARTIFACT — the application's issue 3033.
//
// This case pins one thing: neither the manifest nor the flow definition, read
// as text, names the blog image extension.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG_IMAGE_EXTENSION = "@cinatra-ai/blog-image-artifact";

test("neither the manifest nor the flow names the blog image extension", () => {
  for (const file of ["package.json", join("cinatra", "oas.json")]) {
    const text = readFileSync(join(root, file), "utf8");
    assert.ok(
      !text.includes(BLOG_IMAGE_EXTENSION),
      `${file} names ${BLOG_IMAGE_EXTENSION}`,
    );
  }
});
