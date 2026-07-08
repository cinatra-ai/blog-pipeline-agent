# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

## v0.1.2 — 2026-07-07

- fix: the idea-selection gate receives the generated ideas as a declared input and presents them to the reviewer, and the draft-review step is a real pause instead of an auto-skip (#30)
- feat: the draft and LinkedIn-post outputs are bound to declarative artifact materialization, producing blog-post artifacts on run completion (cinatra#922, cinatra#923) — requires Cinatra 0.1.7 (#29)
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
