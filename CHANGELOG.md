# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

## v0.2.3 — 2026-09-16

- chore: the stored-ideas gate is written as what it now is — a tool this package declares, which the pipeline's three fixed steps reach through the one generic extension-tool dispatch Cinatra offers every extension — and the refusal a caller reads when it names no artifact type is prefixed by that declared tool name (`stored_ideas`) instead of the tool name the host used to own
- ci: this package's named verification suite is committed at `.github/gate-suite.json` — the four checks this repository's main ruleset requires, each with the reusable workflow and the engine commit its own caller pins, the attribution gate by name, and the central high-risk path set it extends

## v0.2.2 — 2026-09-13

- fix: the flow carries the brand-voice pause the plan names — a `brand_voice_gate` pause between the reservation and the draft, declared like the pipeline's other gates so it is drawn as a rail entry, and its pick is handed down to the writing step's `voice` input, which no step of the run had ever filled (#62)

## v0.2.1 — 2026-09-13

- feat: the pipeline no longer composes a reviewer of its own — the draft-review step is now a pure mid-run hold and the approve / request-changes / reject decision is taken on the review step Cinatra opens for the generated draft (core artifact-lifecycle interception). The four metadata-only child review gate steps and the required `@cinatra-ai/reviewer-agent` runtime dependency are removed; `renderer-binding-gate.mjs` gains a fail-closed exact-identity ratchet against the retired lifecycle agents (#59)
- chore: republish the stored-ideas declaration (`blog_pipeline_ideas`) that changed after 0.2.0 was published, so version-pinned installs resolve the current manifest (#60)

## v0.1.2 — 2026-07-07

- fix: the idea-selection gate receives the generated ideas as a declared input and presents them to the reviewer, and the draft-review step is a real pause instead of an auto-skip (#30)
- feat: the draft and LinkedIn-post outputs are bound to declarative artifact materialization, producing blog-post artifacts on run completion — requires Cinatra 0.1.7 (#29)
- chore(deps): cross-extension agent dependencies declared as caret semver ranges, so a patch release of a dependency no longer strands this extension (#28)
- chore(deps): declare `cinatra.consumes` for closure-gate enrollment (#26)
- chore: drop the redundant OAS version copy (#25) and the legacy `cinatra.agentDependencies` map (#23)
- ci(release): pin the release workflow to the gated reusable extension-release flow (release-approval wall) (#22)
- docs/ci: README expanded to the org standard (#15); source-leak-gate callers adopted (#17, #18); private tracker references stripped from public source (#19)

## v0.1.1 — 2026-06-23

- Release prep: required dependencies pinned to exact promoted versions (#14)
- ci: org gate suite adopted — source-leak, actions-pinned, attribution (WARN), extension-to-host IoC conformance, secret-scan, tag-driven GitHub release (#1–#4, #10–#13)
- chore: packaging hygiene (npm files allowlist, source-archive export-ignore), .gitignore, Renovate (#3, #6, #8)

## v0.1.0 — 2026-06-04

- Initial release.
