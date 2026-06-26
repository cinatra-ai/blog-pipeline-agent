# Blog Pipeline Agent

Orchestrates end-to-end blog content creation from a single brief. The agent generates a batch of ideas, pauses for you to pick one, drafts a polished markdown post, writes matching image prompts, and produces a LinkedIn promo — all in one run, with an approval gate between each stage so nothing advances without your sign-off.

**Install:** find Blog Pipeline Agent in the marketplace and add it to your workspace. No credentials are required; the agent uses the Cinatra platform to call its child agents.

**Configuration:** pass a `brief` (required) plus optional `audience`, `tone` (default: informative), `length` (default: medium), `referenceContent`, `companyUrl`, `blogPostUrl`, and `imageCount` (default: 1) when you start a run. The `projectId` and `cinatra_run_id` fields are set automatically by the platform.

**API contract:** inputs — `brief` (required), `audience`, `tone`, `length`, `referenceContent`, `companyUrl`, `blogPostUrl`, `imageCount`, `projectId`, `cinatra_run_id`; outputs — `ideas` array, `draft` object, `imagePrompts` array, `linkedinPost` string.

**Development:** clone the repo, run `node extension-kind-gate.mjs` to validate the extension manifest and README before publishing.

**Troubleshooting:** if a run stalls at a review gate, check that the reviewer agent is installed in your workspace. If outputs are empty, verify that all four child agents (idea generator, draft writer, image prompt, LinkedIn writer) are installed.

## Works with

- Cinatra platform (Flow runtime with reviewer-agent approval gates)

## Capabilities

- Generate a batch of distinct blog ideas from a short brief
- Draft the selected idea into a polished markdown post
- Write image prompts sized to the finished post
- Produce a LinkedIn promo tuned to the new article
- Hold for your approval at each stage before advancing
