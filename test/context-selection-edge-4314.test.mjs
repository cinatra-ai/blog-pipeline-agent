// The flow's brand-voice pick (cinatra-ai/cinatra#4314) is a declared context
// slot that the host draws with the context-selection agent's screen. The host
// resolves the slot through the node its loader injects at mount, and it counts
// that injected node as the slot's wiring only when the package declares an
// install-blocking edge on that agent (cinatra
// `packages/extensions/src/__tests__/contextslots-require-explicit-context-selection-agent.test.ts`).
// Without the edge, the pick could resolve against an agent that was never
// installed.
//
// On the pack commit ed6c3082 the flow declares the slot and the screen but the
// manifest has no such edge, so the edge case below fails there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));

const SELECTOR = "@cinatra-ai/context-selection-agent";

test("#4314: the flow declares a context slot and draws it with the context selector", () => {
  const slots = oas.metadata.cinatra.contextSlots ?? [];
  assert.ok(slots.length > 0, "the flow declares no context slot");
  assert.ok(
    oas.metadata.cinatra.hitlScreens.includes(`${SELECTOR}:context-selector`),
    "the flow does not name the context selector's screen",
  );
});

test("#4314: the manifest declares one required runtime edge on the context-selection agent", () => {
  const edges = (pkg.cinatra.dependencies ?? []).filter((d) => d.packageName === SELECTOR);
  assert.equal(edges.length, 1, `the manifest declares ${edges.length} edges on ${SELECTOR}`);
  const [edge] = edges;
  assert.equal(edge.edgeType, "runtime");
  assert.equal(edge.requirement, "required");
  assert.equal(edge.kind, "agent");
  assert.deepEqual(edge.versionConstraint, { kind: "semver-range", range: "^0.1.1" });
  assert.equal(
    pkg.cinatra.agentDependencies,
    undefined,
    "the legacy agentDependencies map must not come back beside the canonical edge",
  );
});
