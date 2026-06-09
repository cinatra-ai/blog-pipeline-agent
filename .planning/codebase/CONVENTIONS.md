# Coding Conventions

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo. It ships no `src/` TypeScript — the sole implementation artifact is `extension-kind-gate.mjs` (a self-contained Node.js ESM script) plus the `cinatra/oas.json` manifest. All conventions below are derived from those files and the CI pipeline.

## Naming Patterns

**Files:**
- Kebab-case with dot-separated type suffix: `extension-kind-gate.mjs`
- Cinatra manifest files live under `cinatra/`: `cinatra/oas.json`
- GitHub Actions workflows follow lowercase kebab: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**Functions:**
- camelCase for all exported and internal functions: `parseArgs`, `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`, `walkLlmStrings`, `scanOasString`
- Verb-noun pattern for validators: `validateAgent`, `validateWorkflow`, `validateWorkflowPackageShape`, `validateBpmnSanity`
- Verb-noun pattern for finders: `findWorkflowSidecars`

**Variables:**
- camelCase for locals: `packageRoot`, `oasPath`, `bpmnPath`, `allSidecars`
- UPPER_SNAKE_CASE for module-level constants: `LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, `PRIMITIVE_PATTERNS`, `OBJECTS_LIST_CRM_RE`, `BPMN_MODEL_NS`, `WORKFLOW_PACKAGE_NAME_RE`

**Types:**
- No custom types defined (plain JS/JSDoc — the `.mjs` file uses no TypeScript)

## Code Style

**Formatting:**
- Not detected (no `.prettierrc`, `biome.json`, or `.eslintrc` present)
- Code uses 2-space indentation consistently throughout `extension-kind-gate.mjs`
- Double quotes for strings

**Linting:**
- No linter config detected in this repo
- Linting is the responsibility of the parent cinatra monorepo

## Module System

**Format:** ES Modules (ESM) — `"type": "module"` in `package.json`, `.mjs` extension
**Imports:** Only Node.js built-ins used (`node:fs`, `node:path`). No third-party dependencies.

```js
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, basename, dirname, relative } from "node:path";
```

**Exports:** Named exports for all gate functions; no default export. CLI entry via `invokedDirectly` guard at module bottom:

```js
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) { ... }
```

## Import Organization

**Order:**
1. Node built-in modules (prefixed `node:`)
2. No third-party imports exist
3. No local imports (single-file module)

## Error Handling

**Pattern:** Pure functions returning `string[]` errors — callers accumulate and report.

```js
/** Validate an agent extension at packageRoot. Pure: returns string[] errors. */
export function validateAgent(packageRoot) {
  const errors = [];
  // ... checks push to errors[]
  return errors;
}
```

- No exceptions thrown to callers; internal `try/catch` converts filesystem errors to error strings
- Exit codes used at CLI boundary: `0` = pass, `1` = violations found, `2` = dependency-shape regression (CI script)
- `process.exit()` only in `main()` — never in pure validation functions

## Logging

**Framework:** `console.log` / `console.error` (no logger library)

**Patterns:**
- Success: `console.log("✓ extension-kind-gate: ...")` to stdout
- Failures: `console.error("✗ extension-kind-gate: ...")` to stderr with bulleted list
- CI steps use `echo` + `::error::` GitHub Actions annotation syntax

## Comments

**When to Comment:**
- Top-of-file block comment explaining self-contained constraint, scope, and usage — mandatory for this file (it is shipped into external repos)
- Section separator comments (`// --- section name ---`) dividing logical sections
- JSDoc `/** */` on exported functions describing contract and purity

**JSDoc:**
- Used on exported functions only: `validateAgent`, `validateWorkflowPackageShape`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`
- Inline rationale comments for non-obvious decisions (e.g., why `npx` vs `pnpm dlx`)

## Function Design

**Size:** Functions are focused; longest is `validateBpmnSanity` (~80 lines) handling XML walking inline
**Parameters:** Single `packageRoot: string` for gate functions; data-in for pure validators (`validateWorkflowPackageShape(pkg)`, `validateBpmnSanity(xml)`)
**Return Values:** Pure validator functions return `string[]`; `runGate` returns `{ kind, errors }`

## Package Shape Constraints

- No `dependencies`, `devDependencies`, or `optionalDependencies` for first-party `@cinatra-ai/*` packages — these MUST be `peerDependencies` with `peerDependenciesMeta.optional: true`
- Agent dependencies declared under `cinatra.agentDependencies` (not npm `dependencies`)
- `cinatra.kind` must be `"agent"` for this repo

---

*Convention analysis: 2026-06-09*
