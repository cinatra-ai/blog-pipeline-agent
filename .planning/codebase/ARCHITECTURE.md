<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌────────────────────────────────────────────────────────────────────┐
│               StartNode — "Pipeline inputs"                        │
│  brief (required), audience, tone, length, referenceContent,       │
│  companyUrl, blogPostUrl, imageCount, projectId, cinatra_run_id    │
└────────────────────┬───────────────────────────────────────────────┘
                     │ (control + data flow)
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│  FlowNode: idea_flow  (@cinatra-ai/blog-idea-generator-agent)      │
│  → LLM call via /api/llm-bridge (gpt-5.5)                         │
│  → context resolution sub-flow (ideaContext slot)                  │
│  Output: ideas[] (array of {title, summary, outline})              │
└────────────────────┬───────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│  InputMessageNode: idea_selection_gate  (reviewer-agent HITL)      │
│  Operator selects which idea to draft                              │
│  Output: selectedIdeaJson (string)                                 │
└────────────────────┬───────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│  ApiNode: selected_idea  (seam — ideas[] + selectedIdeaJson → idea)│
│  Deterministic shape bridge: array → single object                 │
│  Output: idea (object)                                             │
└────────────────────┬───────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────────┐
│  FlowNode: draft_flow  (@cinatra-ai/blog-draft-writer-agent)       │
│  Output: draft (object)                                            │
└────────────────────┬───────────────────────────────────────────────┘
                     │
             ┌───────┴────────┐
             ▼                ▼
┌────────────────────┐  ┌─────────────────────────────────────────── ┐
│ ApiNode:           │  │ ApiNode: draft_projection (seam)            │
│ image_flow         │  │ draft obj → postTitle, postExcerpt,         │
│ (image-prompt-     │  │ blogPostContent (string fields for linkedin) │
│  agent)            │  └─────────────────────┬───────────────────────┘
│ Output: prompts[]  │                        │
└────────┬───────────┘                        ▼
         │                       ┌────────────────────────────────────┐
         │                       │ FlowNode: linkedin_flow             │
         │                       │ (@cinatra-ai/blog-linkedin-writer)  │
         │                       │ Output: post (string)               │
         │                       └───────────────┬────────────────────┘
         │                                       │
         └──────────────┬────────────────────────┘
                        ▼
┌────────────────────────────────────────────────────────────────────┐
│  EndNode: end                                                      │
│  ideas[], draft{}, imagePrompts[], linkedinPost (string)           │
└────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| StartNode (`start`) | Accept pipeline inputs; enforce brief as required; propagate projectId + cinatra_run_id | `cinatra/oas.json` (node id: `start`) |
| FlowNode (`idea_flow`) | Delegate to blog-idea-generator-agent sub-flow; produce ideas array | `cinatra/oas.json` (node id: `idea_flow`) |
| InputMessageNode (`idea_selection_gate`) | Human-in-the-loop gate via reviewer-agent; operator picks winning idea | `cinatra/oas.json` (node id: `idea_selection_gate`) |
| ApiNode (`selected_idea`) | Shape seam: parse selectedIdeaJson + ideas array → single idea object | `cinatra/oas.json` (node id: `selected_idea`) |
| FlowNode (`draft_flow`) | Delegate to blog-draft-writer-agent sub-flow; produce draft object | `cinatra/oas.json` (node id: `draft_flow`) |
| ApiNode (`draft_projection`) | Shape seam: extract postTitle, postExcerpt, blogPostContent from draft object | `cinatra/oas.json` (node id: `draft_projection`) |
| FlowNode (`image_flow`) | Delegate to blog-image-prompt-agent; produce imagePrompts array | `cinatra/oas.json` (node id: `image_flow`) |
| FlowNode (`linkedin_flow`) | Delegate to blog-linkedin-writer-agent; produce linkedinPost string | `cinatra/oas.json` (node id: `linkedin_flow`) |
| EndNode (`end`) | Collect final outputs: ideas, draft, imagePrompts, linkedinPost | `cinatra/oas.json` (node id: `end`) |
| CI gate script | Self-contained Node.js gate; validates OAS for retired CRM primitives and workflow BPMN shape | `extension-kind-gate.mjs` |

## Pattern Overview

**Overall:** WayFlow Flow OAS — declarative, data-flow-driven multi-agent pipeline (Cinatra agentspec v26.1.0)

**Key Characteristics:**
- All orchestration is declared in `cinatra/oas.json` as a JSON graph of nodes + edges; there is no imperative runtime code
- Two deterministic ApiNode "seams" (`selected_idea`, `draft_projection`) bridge incompatible type shapes between child agents (array→object and object→string fields)
- `projectId` and `cinatra_run_id` are threaded as pass-through parameters to every child FlowNode
- HITL is confined to child reviewer-agent gates (`@cinatra-ai/reviewer-agent:output`); this orchestrator has no HITL screen of its own
- Transcript input is explicitly dropped at the StartNode (`inputContract: "Manual brief / reference artifacts only. Transcript input is DROPPED."`)
- image_flow and linkedin_flow are sequentially connected (image first, then linkedin) even though they are logically independent; no parallel fan-out is declared

## Layers

**Orchestration Layer:**
- Purpose: Top-level WayFlow Flow composing child agents in sequence
- Location: `cinatra/oas.json` (top-level `$referenced_components` section)
- Contains: StartNode, FlowNodes referencing child agents, seam ApiNodes, EndNode, control and data flow edge definitions
- Depends on: Child agent packages listed in `cinatra.agentDependencies` in `package.json`
- Used by: Cinatra platform runtime

**Child Agent Sub-flows (embedded in OAS):**
- Purpose: Each child agent's internal flow graph is inlined into `cinatra/oas.json` under `$referenced_components`
- Location: `cinatra/oas.json` (nested `$referenced_components` blocks, e.g. `blog-idea-generator-agent-subflow`)
- Contains: Sub-flows expand to their own StartNode, context-resolution sub-flows, LLM ApiNodes (calling `/api/llm-bridge`), and EndNodes
- Depends on: Cinatra backend APIs (`/api/llm-bridge`, `/api/context-resolve`, `/api/context-finalize`)
- Used by: Parent FlowNodes at orchestration layer

**CI / Validation Layer:**
- Purpose: Pre-publish sanity gate for the agent OAS and (for workflow kinds) BPMN shape
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `runGate`; no external dependencies
- Depends on: Node.js built-ins only (`fs`, `path`)
- Used by: `.github/workflows/ci.yml` (`kind-gates` job)

## Data Flow

### Primary Request Path

1. **StartNode** receives `brief` (required) + optional params (`cinatra/oas.json`, node `start`)
2. **idea_flow** FlowNode passes brief/audience/tone/referenceContent/projectId/cinatra_run_id to blog-idea-generator-agent sub-flow (`cinatra/oas.json`, data edges `start_brief__idea_flow_brief` etc.)
3. Inside idea sub-flow: context resolution (`/api/context-resolve`) → branch on selectionMode → optional HITL gate → context finalize (`/api/context-finalize`) → LLM call to `/api/llm-bridge` with gpt-5.5 → returns `{ideas, notes}`
4. **idea_selection_gate** InputMessageNode pauses for operator to select an idea; emits `selectedIdeaJson`
5. **selected_idea** ApiNode merges ideas array + selectedIdeaJson → single `idea` object
6. **draft_flow** FlowNode forwards idea + tone/length/audience/referenceContent/projectId/cinatra_run_id to blog-draft-writer-agent → returns `draft` object
7. **draft_projection** ApiNode extracts `postTitle`, `postExcerpt`, `blogPostContent` from draft (shape seam)
8. **image_flow** FlowNode receives draft object + imageCount + projectId/cinatra_run_id → returns `prompts[]`
9. **linkedin_flow** FlowNode receives projected draft fields + blogPostUrl + companyUrl/cinatra_run_id → returns `post` string
10. **EndNode** collects: `ideas[]`, `draft{}`, `imagePrompts[]`, `linkedinPost` (`cinatra/oas.json`, node `end`)

### Context Resolution Sub-flow (inside idea_flow)

1. `ctx-ideaContext-resolve_context` ApiNode calls `/api/context-resolve` with parentRunId, parentPackageName, slotId, projectId
2. `ctx-ideaContext-select_mode` BranchingNode routes on `selectionMode`: `autonomous` branch bypasses HITL; `default` branch goes through interactive gate
3. Interactive path: `ctx-ideaContext-emit_context_payload` OutputMessageNode → `ctx-ideaContext-context_select_gate` InputMessageNode (HITL) → `ctx-ideaContext-finalize_interactive` ApiNode calls `/api/context-finalize`
4. Autonomous path: `ctx-ideaContext-finalize_autonomous` ApiNode calls `/api/context-finalize` with pre-resolved selectedRefs
5. Output: `contextSlotBindings[]` injected into the generate LLM ApiNode

**State Management:**
- No persistent state in this repo; all state is managed by the Cinatra platform runtime and threaded via `projectId` / `cinatra_run_id` across child nodes

## Key Abstractions

**FlowNode:**
- Purpose: A reference to a child agent's sub-flow, executed inline within the parent pipeline
- Examples: `idea_flow`, `draft_flow`, `image_flow`, `linkedin_flow` — all in `cinatra/oas.json`
- Pattern: `"component_type": "FlowNode"` with a `"subflow": { "$component_ref": "<id>" }` pointer

**Seam ApiNode:**
- Purpose: Deterministic shape transform between child agent output type and next child's expected input type — no LLM involved
- Examples: `selected_idea` (ideas[]+selectedIdeaJson → idea object), `draft_projection` (draft object → flat string fields)
- Pattern: `"component_type": "ApiNode"` targeting Cinatra internal API or a pure transformation endpoint

**DataFlowEdge:**
- Purpose: Explicit typed wiring between a source node's output field and a destination node's input field
- Examples: `start_brief__idea_flow_brief`, `draft_flow_draft__end_draft` — all in `cinatra/oas.json` `data_flow_connections`
- Pattern: `{ source_node, source_output, destination_node, destination_input }`

**ControlFlowEdge:**
- Purpose: Execution sequencing between nodes (independent of data)
- Examples: `start_to_idea_flow`, `idea_flow_to_idea_selection_gate` — in `cinatra/oas.json` `control_flow_connections`
- Pattern: `{ from_node, to_node }` (with optional `from_branch` for BranchingNodes)

## Entry Points

**Pipeline Entry:**
- Location: `cinatra/oas.json`, StartNode id `start`
- Triggers: Invoked by Cinatra platform when a user submits a run with a `brief`
- Responsibilities: Validate required inputs, fan data out to first child FlowNode (`idea_flow`)

**CI Gate Entry:**
- Location: `extension-kind-gate.mjs`, `main()` function (line 365)
- Triggers: `node extension-kind-gate.mjs --package-root .` from `.github/workflows/ci.yml`
- Responsibilities: Read `package.json`, detect `cinatra.kind`, dispatch to `validateAgent` or `validateWorkflow`

## Architectural Constraints

- **Threading:** Single declarative pass — no parallel fan-out; image_flow and linkedin_flow run sequentially even though they could be independent
- **Global state:** None — stateless flow; all state in Cinatra platform
- **Circular imports:** Not applicable (no TypeScript source files; pure JSON + one standalone `.mjs` script)
- **Input contract:** Transcript input is hard-dropped at StartNode; only manual brief + reference artifacts are accepted
- **Skill-id declarations:** Zero skill-id declarations in the OAS (owner law enforced); child agents auto-discover SKILL.md via `agent_id` at the LLM bridge
- **Tool access:** `package.json` declares `cinatra.toolAccess: []` — no MCP tools accessible at the orchestrator level
- **HITL placement:** Only child reviewer-agent gates produce approval screens; orchestrator itself has `hasApprovalGates: true` solely because children carry gates

## Anti-Patterns

### Unnecessary Sequential Execution of Independent Nodes

**What happens:** `image_flow` and `linkedin_flow` are wired sequentially (`image_flow_to_linkedin_flow` ControlFlowEdge); they only share the upstream `draft_flow` output, not each other's outputs.
**Why it's wrong:** Sequential execution adds unnecessary latency; both nodes could run in parallel after `draft_projection` completes.
**Do this instead:** Add a parallel fan-out ControlFlowEdge from `draft_projection` to both `image_flow` and `linkedin_flow`, then merge at a join node before `end`. (Cinatra WayFlow supports parallel branches.)

## Error Handling

**Strategy:** Delegated to Cinatra platform runtime; individual ApiNodes and FlowNodes surface errors via the platform's standard error propagation. No custom error-handling nodes are declared in this flow.

**Patterns:**
- ApiNodes that call `/api/llm-bridge` rely on platform-level retry and timeout handling
- CI gate (`extension-kind-gate.mjs`) uses pure function returns of `string[]` errors, exits 0 on pass and 1 on violation

## Cross-Cutting Concerns

**Logging:** Delegated to Cinatra platform; no application-level logging in this repo
**Validation:** CI gate in `extension-kind-gate.mjs` scans for retired CRM primitives in OAS LLM-visible strings (`system`, `user`, `description` fields); `validateAgent` function is the authoritative check
**Authentication:** `{{CINATRA_BASE_URL}}` template variable injected by platform at runtime; no auth tokens stored in this repo

---

*Architecture analysis: 2026-06-09*
