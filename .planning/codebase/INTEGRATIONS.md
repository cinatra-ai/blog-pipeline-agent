# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Cinatra Marketplace Registry:**
- Service: `registry.cinatra.ai` — target registry for publishing this extension
- Submission: via MCP proxy (`extension-submit-for-review`) triggered by GitHub Release
- Auth: `CINATRA_MARKETPLACE_VENDOR_TOKEN` org secret (injected by reusable CI workflow `cinatra-ai/.github/.github/workflows/reusable-extension-release.yml`)

**Child Agent FlowNodes (Cinatra platform, runtime):**
- `@cinatra-ai/blog-idea-generator-agent` — invoked as FlowNode `idea_flow` inside `cinatra/oas.json`
- `@cinatra-ai/blog-draft-writer-agent` — invoked as FlowNode `draft_flow`
- `@cinatra-ai/blog-image-prompt-agent` — invoked as FlowNode `image_flow`
- `@cinatra-ai/blog-linkedin-writer-agent` — invoked as FlowNode `linkedin_flow`
- `@cinatra-ai/reviewer-agent` — invoked as FlowNode `idea_selection_gate` (HITL approval gate)

All child agents are resolved and executed within the Cinatra WayFlow runtime; no direct HTTP calls are made from this repo's code.

## Data Storage

**Databases:**
- Not applicable — this is a stateless orchestration flow; no database client or connection declared.

**File Storage:**
- Not applicable

**Caching:**
- Not applicable

## Authentication & Identity

**Auth Provider:**
- Cinatra platform handles auth for child agent invocations; no auth logic in this repo.
- HITL screen: `@cinatra-ai/reviewer-agent:output` (declared in `cinatra/oas.json` under `metadata.cinatra.hitlScreens`) — operator reviews intermediate outputs before pipeline advances.

## Monitoring & Observability

**Error Tracking:**
- Not detected — no error-tracking SDK present.

**Logs:**
- Handled by Cinatra WayFlow runtime; no local logging configured.

## CI/CD & Deployment

**Hosting:**
- Cinatra Marketplace (`registry.cinatra.ai`)

**CI Pipeline:**
- GitHub Actions
  - `.github/workflows/ci.yml` — runs on push/PR to `main`; steps: checkout, Node 24 setup, Corepack, first-party dep shape validation, install (skipped for source mirrors), typecheck (skipped for source mirrors), test (skipped for source mirrors), `npm pack --dry-run`, OAS validation gate via `extension-kind-gate.mjs`
  - `.github/workflows/release.yml` — triggered by published GitHub Release; delegates entirely to `cinatra-ai/.github/.github/workflows/reusable-extension-release.yml@main`

**Secrets location:**
- `CINATRA_MARKETPLACE_VENDOR_TOKEN` — GitHub org secret, consumed only by the release workflow via `secrets: inherit`

## Webhooks & Callbacks

**Incoming:**
- Not applicable

**Outgoing:**
- Marketplace submission webhook is handled by the reusable release workflow (internal Cinatra infra); no outgoing webhooks configured in this repo.

## Flow Topology (OAS nodes)

The `cinatra/oas.json` defines 9 nodes wired as a directed flow:

| Node ID | Role |
|---|---|
| `start` | Flow entry point |
| `idea_flow` | Child agent: blog-idea-generator-agent |
| `idea_selection_gate` | HITL reviewer gate (operator approves idea) |
| `selected_idea` | Deterministic seam ApiNode (idea array → draft object) |
| `draft_flow` | Child agent: blog-draft-writer-agent |
| `draft_projection` | Deterministic seam ApiNode (draft object → LinkedIn string) |
| `image_flow` | Child agent: blog-image-prompt-agent |
| `linkedin_flow` | Child agent: blog-linkedin-writer-agent |
| `end` | Flow exit point |

Flow inputs accepted: `brief`, `audience`, `tone`, `length`, `referenceContent`, `companyUrl`, `blogPostUrl`, `imageCount`, `projectId`, `cinatra_run_id`.

Flow outputs produced: `ideas` (array), `draft`, image prompts, LinkedIn copy (exact output field names in full OAS).

---

*Integration audit: 2026-06-09*
