# Testing Patterns

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo (no `src/` TypeScript). The single testable implementation file is `extension-kind-gate.mjs`. No test files are present in the repo; testing is owned by the parent cinatra monorepo.

## Test Framework

**Runner:** Not detected — no `jest.config.*`, `vitest.config.*`, or test runner in `package.json`

**Assertion Library:** Not detected

**Run Commands:**
```bash
# From CI (standalone repos only — this repo is a source mirror with @cinatra-ai/* peers):
corepack pnpm test --if-present   # runs if a `test` script exists in package.json

# This repo has no `test` script; CI skips the test step for source mirrors:
# "Skipping standalone tests (host-internal @cinatra-ai/* peers — the cinatra monorepo runs these)."
```

## Test File Organization

**Location:** No test files present in this repo
**Naming:** Not applicable
**Structure:** Not applicable

## CI Test Behavior

The CI pipeline (`.github/workflows/ci.yml`) classifies this repo as a **source mirror** because it declares host-internal `@cinatra-ai/*` packages as optional peer dependencies. As a result:

- `Install dependencies` step is skipped
- `Typecheck` step is skipped
- `Test` step is skipped

All install, typecheck, and test execution is delegated to the cinatra monorepo.

## Kind Gate (Functional Validation — Not Unit Tests)

The primary quality gate is the `extension-kind-gate.mjs` script, run as a CI step:

```bash
node extension-kind-gate.mjs --package-root .
```

This script validates:
- `cinatra/oas.json` parses as valid JSON
- No retired CRM primitives (`lists_list`, `contacts_get`, etc.) appear in LLM-visible OAS fields (`system`, `user`, `description`)
- No banned entity typeHints (`@cinatra-ai/entity-accounts:account`, `@cinatra-ai/entity-contacts:contact`)

Exported functions in `extension-kind-gate.mjs` are pure (return `string[]` errors) and are designed to be unit-testable by the monorepo:
- `parseArgs(argv)` — `extension-kind-gate.mjs:42`
- `validateAgent(packageRoot)` — `extension-kind-gate.mjs:131`
- `validateWorkflowPackageShape(pkg)` — `extension-kind-gate.mjs:165`
- `validateBpmnSanity(xml)` — `extension-kind-gate.mjs:200`
- `findWorkflowSidecars(packageRoot)` — `extension-kind-gate.mjs:287`
- `runGate(packageRoot)` — `extension-kind-gate.mjs:352`

## Mocking

**Framework:** Not applicable (no test suite in repo)
**What to Mock:** Not applicable

## Fixtures and Factories

**Test Data:** Not applicable — the monorepo provides fixture OAS/BPMN files when testing `extension-kind-gate.mjs`

## Coverage

**Requirements:** Not enforced in this repo
**View Coverage:** Not applicable

## Test Types

**Unit Tests:** Owned by cinatra monorepo (targets exported pure functions in `extension-kind-gate.mjs`)
**Integration Tests:** Not applicable
**E2E Tests:** Not applicable

## Pack Dry-Run Gate

As a substitute for standalone tests, CI runs a pack validation:

```bash
npm pack --dry-run
```

This validates package shape and publish payload without resolving peers. It is the only standalone quality check that runs unconditionally on this repo.

---

*Testing analysis: 2026-06-09*
