# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript (ES2023 target) - Source compilation via `tsconfig.json`
- JavaScript (ESM, `.mjs`) - CI gate utility `extension-kind-gate.mjs`

**Secondary:**
- JSON - Agent OAS manifest `cinatra/oas.json`

## Runtime

**Environment:**
- Node.js 24 (specified in `.github/workflows/ci.yml` via `actions/setup-node`)

**Package Manager:**
- pnpm (managed via Corepack — `corepack enable` in CI)
- Lockfile: not committed (CI uses `--no-frozen-lockfile`)
- `.npmrc`: `auto-install-peers=false`

## Frameworks

**Core:**
- Cinatra WayFlow / Flow OAS — parent orchestrator runtime composing child FlowNodes; declared via `cinatra/oas.json` with `agentspec_version: 26.1.0` and `component_type: Flow`

**Build/Dev:**
- TypeScript compiler (`tsc`) — targets `dist/`, roots at `src/`; config at `tsconfig.json`
- No bundler configured (module resolution: `bundler` mode in tsconfig)

**Testing:**
- Not detected (no test framework declared in `package.json`; CI runs `pnpm test --if-present` which is a no-op for source-mirror repos)

## Key Dependencies

**Agent Dependencies (runtime, Cinatra Marketplace):**
- `@cinatra-ai/blog-idea-generator-agent` `^0.1.0` — idea generation FlowNode
- `@cinatra-ai/blog-draft-writer-agent` `^0.1.0` — draft writing FlowNode
- `@cinatra-ai/blog-image-prompt-agent` `^0.1.0` — image prompt FlowNode
- `@cinatra-ai/blog-linkedin-writer-agent` `^0.1.0` — LinkedIn promo FlowNode
- `@cinatra-ai/reviewer-agent` `^0.1.0` — HITL reviewer gate (approval gates)

All declared under `cinatra.agentDependencies` in `package.json` and as `peerDependencies` (optional) — these are host-internal packages resolved only within the Cinatra monorepo, never published to a public registry.

**Infrastructure:**
- None (zero `dependencies` or `devDependencies` in `package.json`)

## Configuration

**Environment:**
- No `.env` files present
- No runtime environment variables required by this repo directly (orchestration is driven by Cinatra platform config)

**Build:**
- `tsconfig.json` — strict TypeScript; outputs to `dist/`; source root `src/`
- `package.json` — `"type": "module"` (ESM); Cinatra manifest embedded under `cinatra` key

## Platform Requirements

**Development:**
- Node.js 24+
- pnpm via Corepack

**Production:**
- Cinatra Marketplace / Cinatra monorepo (source mirror pattern — not standalone-installable)
- Published via GitHub Release triggering `release.yml` → `cinatra-ai/.github` reusable workflow → `registry.cinatra.ai`
- Package name: `@cinatra-ai/blog-pipeline-agent` v0.1.0

---

*Stack analysis: 2026-06-09*
