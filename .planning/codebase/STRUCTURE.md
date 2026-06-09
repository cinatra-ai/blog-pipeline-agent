# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
blog-pipeline-agent/
├── cinatra/
│   └── oas.json              # Full WayFlow Flow OAS — single source of truth for the pipeline
├── .github/
│   └── workflows/
│       ├── ci.yml            # Standalone CI: classify, typecheck, test, pack dry-run, OAS gate
│       └── release.yml       # Release workflow
├── .planning/
│   └── codebase/             # GSD codebase map documents (generated, not committed by default)
├── extension-kind-gate.mjs   # Self-contained CI gate: OAS retired-primitive scan + BPMN shape check
├── package.json              # NPM manifest + cinatra agent metadata + agentDependencies
├── tsconfig.json             # TypeScript config (no TS source files; present for CI typecheck path)
├── .npmrc                    # NPM registry config (existence noted; contents not read)
└── LICENSE                   # Apache-2.0
```

## Directory Purposes

**`cinatra/`:**
- Purpose: Cinatra platform sidecar directory; required by convention for all Cinatra extensions
- Contains: `oas.json` — the complete WayFlow Flow OAS (agentspec v26.1.0) defining all nodes, edges, sub-flows, and embedded child agent graphs
- Key files: `cinatra/oas.json` (5127 lines; the single authoritative artifact for this agent)

**`.github/workflows/`:**
- Purpose: GitHub Actions CI/CD
- Contains: `ci.yml` (baseline + agent OAS gate), `release.yml` (publish workflow)
- Key files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents written by gsd-map-codebase
- Contains: ARCHITECTURE.md, STRUCTURE.md (this file)
- Generated: Yes (by GSD tooling)

## Key File Locations

**Entry Points:**
- `cinatra/oas.json`: The pipeline definition; StartNode id `start` is the runtime entry point; `"start_node": { "$component_ref": "start" }` at the top level

**Configuration:**
- `package.json`: Package identity (`@cinatra-ai/blog-pipeline-agent`), cinatra metadata (`kind: "agent"`, `type: "flow"`, `riskLevel: "low"`, `hasApprovalGates: true`), and `agentDependencies` listing the five required child agents
- `tsconfig.json`: TypeScript config; present so CI typecheck step does not fail with TS18003, but no `.ts` source files exist in this repo
- `.npmrc`: Registry config (existence noted; not read)

**Core Logic:**
- `cinatra/oas.json`: All pipeline logic — node definitions, control flow edges, data flow edges, child agent sub-flow graphs, and seam ApiNode transform specifications
- `extension-kind-gate.mjs`: CI validation logic — `validateAgent()` scans OAS for banned CRM primitives; `validateWorkflow()` checks BPMN shape; `runGate()` is the dispatch entry point

**Testing:**
- No test files present. CI runs `pnpm test --if-present` but there are no tests. This repo is a "source mirror" (declares host-internal `@cinatra-ai/*` peers), so the cinatra monorepo owns testing.

## Naming Conventions

**Files:**
- Cinatra sidecar: `cinatra/oas.json` (fixed path mandated by platform)
- CI gate: `extension-kind-gate.mjs` (kebab-case, `.mjs` ES module)
- Workflows: `ci.yml`, `release.yml` (kebab-case)

**Node IDs in OAS:**
- Top-level flow nodes: `snake_case` (e.g., `idea_flow`, `idea_selection_gate`, `selected_idea`, `draft_projection`)
- Child agent prefixed nodes: `<agent-slug>__<node_name>` with double-underscore separator (e.g., `blog-idea-generator-agent__generate`, `ctx-ideaContext-resolve_context`)
- Context sub-flow nodes: `ctx-<slotId>-<step>` (e.g., `ctx-ideaContext-emit_context_payload`)

**DataFlowEdge names:**
- Pattern: `<source_node>_<source_output>__<destination_node>_<destination_input>` (double-underscore between source and destination)
- Example: `start_brief__idea_flow_brief`, `draft_flow_draft__end_draft`

**ControlFlowEdge names:**
- Pattern: `<from_node>_to_<to_node>` (e.g., `start_to_idea_flow`, `image_flow_to_linkedin_flow`)

**Package naming:**
- Format: `@cinatra-ai/<slug>-agent` for agents (e.g., `@cinatra-ai/blog-pipeline-agent`)

## Where to Add New Code

**Add a new pipeline stage (new child agent):**
1. Declare the new agent in `package.json` under `cinatra.dependencies` and `cinatra.agentDependencies`
2. In `cinatra/oas.json`, add a new FlowNode entry to `nodes[]`
3. Add ControlFlowEdges wiring the new node into the sequence under `control_flow_connections`
4. Add DataFlowEdges passing required inputs and collecting outputs under `data_flow_connections`
5. Add a `$component_ref` entry for the new FlowNode's sub-flow in `$referenced_components`

**Add a new shape seam (type bridge between nodes):**
- Add an ApiNode in `cinatra/oas.json` `$referenced_components` with `component_type: "ApiNode"` and deterministic data transformation in the `data` field
- Wire it inline between the producing and consuming FlowNodes via ControlFlowEdge + DataFlowEdges

**Add a new input parameter:**
- Add to `inputs[]` of the StartNode in `cinatra/oas.json`
- Add corresponding top-level `inputs[]` entry on the Flow itself
- Wire via DataFlowEdge from `start` to each consuming child FlowNode

**Add CI validation rules:**
- Extend `BANNED_PRIMITIVES` or `BANNED_TYPEHINTS` arrays in `extension-kind-gate.mjs`
- Extend `scanOasString()` function for new pattern checks
- All validation functions are pure (return `string[]`); add new pure validator functions following the same pattern

**Add outputs:**
- Add to `outputs[]` of EndNode and top-level Flow `outputs[]` in `cinatra/oas.json`
- Wire via DataFlowEdge from producing node to `end`

## Special Directories

**`cinatra/`:**
- Purpose: Cinatra platform sidecar; must contain `oas.json` for agent kind
- Generated: Partially — `oas.json` is generated from monorepo source by extraction script; it is committed and is the shipped artifact
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning documents
- Generated: Yes (by gsd-map-codebase and gsd-plan-phase)
- Committed: Per project convention (not enforced by this repo's CI)

---

*Structure analysis: 2026-06-09*
