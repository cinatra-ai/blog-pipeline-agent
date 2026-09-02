// The embedded LinkedIn writer must really emit the title the pipeline's
// terminal binding reads. A subflow that DECLARES an output its own end node
// never receives does not mount at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const oas = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "cinatra", "oas.json"),
    "utf8",
  ),
);
const sub = oas.$referenced_components["blog-linkedin-writer-agent-subflow"];
const inner = sub.$referenced_components;

test("every output the subflow declares is produced by its own end node", () => {
  const declared = sub.outputs.map((o) => o.title).sort();
  const produced = inner["blog-linkedin-writer-agent__end"].outputs
    .map((o) => o.title)
    .sort();
  assert.deepEqual(produced, declared);
});

test("and every one of them is edge-sourced from the writing node", () => {
  const writeOutputs = inner["blog-linkedin-writer-agent__write"].outputs.map((o) => o.title);
  for (const out of sub.outputs.map((o) => o.title)) {
    assert.ok(writeOutputs.includes(out), `the writing node must emit ${out}`);
    assert.ok(
      sub.data_flow_connections.some(
        (e) => e.source_output === out && e.destination_input === out,
      ),
      `${out} must be edge-sourced into the subflow's end node`,
    );
  }
});

test("the embedded prompt asks for the title the binding reads", () => {
  assert.match(
    inner["blog-linkedin-writer-agent__write"].data.system,
    /\{post, title, notes\}/,
  );
});
