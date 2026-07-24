#!/usr/bin/env node
// ---------------------------------------------------------------------------
// renderer-binding-gate — self-contained, zero-dependency compile→resolve lock
// for THIS pack's self-owned HITL field-renderer bindings.
//
//     node renderer-binding-gate.mjs --package-root .
//
// cinatra#2002 (build-item 3): the two blog-pipeline HITL gates adopt the #1959
// template — self-namespaced, pack-owned field renderers rather than the shared
// `@cinatra-ai/reviewer-agent:output`. #1959 established that a renamed/removed
// renderer must FAIL THE BUILD (fail-closed) rather than SILENTLY DEGRADE a gate
// to the schema-field floor at runtime. This gate is the author-facing (blog
// repo, pre-publish) half of that lock: it asserts that every self-owned
// renderer reference in `cinatra/oas.json` resolves to a declared
// `cinatra.fieldRenderers` binding in `package.json`, and vice-versa.
//
// SCOPE — SELF-OWNED BINDINGS ONLY. The pack's own namespace is
// `<package.name>:` (e.g. `@cinatra-ai/blog-pipeline-agent:`). SHARED refs owned
// by OTHER extensions — `@cinatra-ai/reviewer-agent:output`,
// `@cinatra-ai/context-selection-agent:context-selector` — are DELIBERATELY out
// of scope: they resolve host-side against the registered renderer map at
// install time, this content-only repo cannot resolve them, and they belong to
// their declaring packs / the reviewer teardown cohort (cinatra#1796 Stage 3).
// Leaving them untouched keeps this gate strictly disjoint from that lane.
//
// WHY SELF-CONTAINED — mirrors the discipline of `extension-kind-gate.mjs`: an
// extracted extension repo's CI runs unauthenticated, BEFORE the @cinatra-ai
// registry is reachable, so a gate that resolved a published tool would fail
// closed on a 404. Node builtins only; no @cinatra-ai dependency; no npx.
//
// This is NOT the vendored `extension-kind-gate.mjs` (canonical owner
// cinatra-cli#72) — it is a pack-owned gate for a pack-specific invariant, so it
// does not fork the vendored file.
//
// CHECKS (each accumulates into the same fail-closed error list):
//   A) resolve       — every self-owned renderer/x-renderer ref in oas.json is
//                       a declared cinatra.fieldRenderers id (catches a removed
//                       or renamed binding: the load-bearing #1959 protection).
//   B) referenced    — every declared self-owned fieldRenderers id is referenced
//                       by at least one gate ref (catches a dead binding or an
//                       oas ref renamed out from under the declaration).
//   C) agreement     — on a gate whose `renderer` is self-owned, the paired
//                       `inputMessageSchema.x-renderer` names the SAME id (a
//                       split rename must not resolve one side and degrade the
//                       other).
//   D) hitl-screen   — every self-owned id used as a gate `renderer` appears in
//                       a flow-level metadata.cinatra.hitlScreens list (else the
//                       host would not classify the pause as a HITL screen).
//   E) shape         — every declared fieldRenderers id is itself self-owned
//                       (a pack declares only its own bindings) and unique.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

// ---- arg parsing (mirrors extension-kind-gate.mjs) ----
export function parseArgs(argv) {
  let packageRoot = ".";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--package-root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--package-root requires a value");
      packageRoot = value;
      i++;
    } else if (arg.startsWith("--package-root=")) {
      packageRoot = arg.slice("--package-root=".length);
    }
  }
  return { packageRoot: resolve(packageRoot) };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Recursively walk a JSON value, invoking visit(node, path) for every object.
function walkObjects(node, path, visit) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walkObjects(node[i], `${path}[${i}]`, visit);
    return;
  }
  if (node && typeof node === "object") {
    visit(node, path);
    for (const key of Object.keys(node)) walkObjects(node[key], `${path}.${key}`, visit);
  }
}

/**
 * Collect the renderer-binding facts an oas.json exposes.
 * @returns {{
 *   refs: Array<{ id: string, kind: "renderer"|"x-renderer", path: string }>,
 *   gates: Array<{ renderer: string|undefined, xRenderer: string|undefined, path: string }>,
 *   hitlScreens: Set<string>,
 * }}
 */
export function collectOasBindings(oas) {
  const refs = [];
  const gates = [];
  const hitlScreens = new Set();
  walkObjects(oas, "$", (node, path) => {
    const rndr = typeof node.renderer === "string" ? node.renderer : undefined;
    const ims = node.inputMessageSchema;
    const xr = ims && typeof ims === "object" && typeof ims["x-renderer"] === "string" ? ims["x-renderer"] : undefined;
    if (rndr !== undefined) refs.push({ id: rndr, kind: "renderer", path: `${path}.renderer` });
    if (xr !== undefined) refs.push({ id: xr, kind: "x-renderer", path: `${path}.inputMessageSchema.x-renderer` });
    // A gate is a node carrying EITHER a `renderer` OR a paired
    // `inputMessageSchema.x-renderer` AND at least one other cinatra HITL-gate
    // marker (inputMessageSchema / a2uiSurfaceId / requiresApproval). The gate
    // discriminator keeps a stray, unrelated `renderer` key from being mistaken
    // for a gate (avoiding a false one-sided failure) while still catching a
    // real gate that lost one of its two sides — a real gate always retains the
    // other markers. Detecting from EITHER side is load-bearing: a gate whose
    // `renderer` was removed but self-owned `x-renderer` remained (or split
    // across a shared/self boundary) is still seen so agreement + hitl-screen
    // checks fire. (Note: a `gateSteps[].renderer` carries no x-renderer and is
    // not a two-sided gate — it is validated only by the resolve check A.)
    const hasGateMarker =
      (ims && typeof ims === "object") ||
      Object.prototype.hasOwnProperty.call(node, "a2uiSurfaceId") ||
      Object.prototype.hasOwnProperty.call(node, "requiresApproval");
    if ((rndr !== undefined || xr !== undefined) && hasGateMarker) {
      gates.push({ renderer: rndr, xRenderer: xr, path });
    }
    if (Array.isArray(node.hitlScreens)) {
      for (const s of node.hitlScreens) if (typeof s === "string") hitlScreens.add(s);
    }
  });
  return { refs, gates, hitlScreens };
}

export function evaluate({ pkg, oas }) {
  const errors = [];
  const selfName = pkg && typeof pkg.name === "string" ? pkg.name : null;
  if (!selfName) {
    return { errors: ["package.json has no string `name` — cannot determine the pack's own renderer namespace"] };
  }
  const selfPrefix = `${selfName}:`;
  const isSelf = (id) => typeof id === "string" && id.startsWith(selfPrefix);

  const cinatra = (pkg.cinatra && typeof pkg.cinatra === "object") ? pkg.cinatra : {};
  // A present-but-non-array fieldRenderers is a manifest defect — flag it rather
  // than silently coercing it to "no bindings" (which would fail OPEN).
  if (cinatra.fieldRenderers !== undefined && !Array.isArray(cinatra.fieldRenderers)) {
    errors.push(`cinatra.fieldRenderers must be an array of binding declarations, got ${typeof cinatra.fieldRenderers}`);
  }
  const declaredList = Array.isArray(cinatra.fieldRenderers) ? cinatra.fieldRenderers : [];

  // (E) shape: declared ids self-owned + unique.
  const declared = new Set();
  const seen = new Set();
  for (const fr of declaredList) {
    const id = fr && typeof fr === "object" ? fr.id : undefined;
    if (typeof id !== "string" || id.length === 0) {
      errors.push(`cinatra.fieldRenderers entry has no string \`id\`: ${JSON.stringify(fr)}`);
      continue;
    }
    if (!isSelf(id)) {
      errors.push(`cinatra.fieldRenderers declares '${id}', which is not self-owned — a pack declares only bindings under its own '${selfPrefix}' namespace`);
    }
    if (seen.has(id)) {
      errors.push(`cinatra.fieldRenderers declares '${id}' more than once`);
    }
    seen.add(id);
    declared.add(id);
  }

  // If oas is absent, there is nothing to resolve. A declared-but-unreferenced
  // binding is still caught below (B) because refs will be empty.
  const { refs, gates, hitlScreens } = oas
    ? collectOasBindings(oas)
    : { refs: [], gates: [], hitlScreens: new Set() };

  // (A) resolve: every self-owned oas ref is declared.
  const referenced = new Set();
  for (const ref of refs) {
    if (!isSelf(ref.id)) continue; // shared refs are out of scope by design
    referenced.add(ref.id);
    if (!declared.has(ref.id)) {
      errors.push(`cinatra/oas.json ${ref.kind} at ${ref.path} references self-owned renderer '${ref.id}', but package.json cinatra.fieldRenderers does not declare it — a renamed/removed binding would silently degrade this HITL gate to the schema-field floor`);
    }
  }

  // (B) referenced: every declared self-owned id appears in ≥1 self ref.
  for (const id of declared) {
    if (!referenced.has(id)) {
      errors.push(`cinatra.fieldRenderers declares '${id}', but no gate in cinatra/oas.json references it (renderer/x-renderer) — dead binding, or an oas ref was renamed away from the declaration`);
    }
  }

  // A gate is "self-implicated" if EITHER side names a self-owned binding. Both
  // the removed-one-side and split-across-shared/self cases surface here.
  for (const g of gates) {
    const rSelf = isSelf(g.renderer);
    const xSelf = isSelf(g.xRenderer);
    if (!rSelf && !xSelf) continue; // shared-only gate — out of scope (Stage-3's)

    // (C) agreement: both sides present, self-owned, and identical.
    if (g.renderer === undefined || g.xRenderer === undefined) {
      const present = g.renderer ?? g.xRenderer;
      const presentSide = g.renderer !== undefined ? "renderer" : "inputMessageSchema.x-renderer";
      errors.push(`self-owned gate at ${g.path} binds only its ${presentSide} ('${present}') — a HITL gate must resolve BOTH renderer and inputMessageSchema.x-renderer to the same self-owned binding (the missing side degrades to the schema-field floor)`);
    } else if (g.renderer !== g.xRenderer) {
      errors.push(`self-owned gate at ${g.path} splits its binding: renderer '${g.renderer}' vs inputMessageSchema.x-renderer '${g.xRenderer}' — a HITL gate must resolve both to the same id`);
    }

    // (D) hitl-screen: every self-owned side of the gate is a registered HITL
    // screen. hitlScreens is unioned across the oas — for this pack's single
    // flow-level list that is exactly "is this id declared a HITL screen".
    for (const id of new Set([g.renderer, g.xRenderer])) {
      if (isSelf(id) && !hitlScreens.has(id)) {
        errors.push(`self-owned gate binding '${id}' at ${g.path} is not listed in any flow-level metadata.cinatra.hitlScreens — the host would not classify the pause as a HITL screen`);
      }
    }
  }

  return { errors };
}

// ---- main ----
export function run(packageRoot) {
  const pkgPath = join(packageRoot, "package.json");
  let pkg;
  try {
    pkg = readJson(pkgPath);
  } catch (err) {
    return { errors: [`cannot read/parse ${pkgPath}: ${err.message}`] };
  }
  let oas = null;
  const oasPath = join(packageRoot, "cinatra", "oas.json");
  const declaredCount = Array.isArray(pkg?.cinatra?.fieldRenderers) ? pkg.cinatra.fieldRenderers.length : 0;
  try {
    oas = readJson(oasPath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      // A genuinely ABSENT oas is tolerated only when the pack declares no
      // self-owned renderers; a declared binding with nothing to resolve
      // against is a fail-closed error.
      if (declaredCount > 0) {
        return { errors: [`cinatra/oas.json is absent, yet package.json declares ${declaredCount} cinatra.fieldRenderers binding(s) that cannot be resolved`] };
      }
    } else {
      // A malformed/unreadable oas (parse error, EACCES, …) must FAIL the
      // resolve lock, never pass it — otherwise a broken oas would fail open.
      return { errors: [`cannot read/parse ${oasPath}: ${err.message} — a malformed OAS fails the resolve lock`] };
    }
  }
  return evaluate({ pkg, oas });
}

function main() {
  const { packageRoot } = parseArgs(process.argv.slice(2));
  const { errors } = run(packageRoot);
  if (errors.length === 0) {
    console.log("✓ renderer-binding-gate: self-owned field-renderer bindings resolve (oas ⇄ manifest)");
    process.exit(0);
  }
  console.error(`\n✗ renderer-binding-gate: ${errors.length} self-owned renderer-binding violation(s):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

const isEntrypoint =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isEntrypoint) {
  try {
    main();
  } catch (err) {
    console.error("renderer-binding-gate: unexpected error", err);
    process.exit(1);
  }
}
