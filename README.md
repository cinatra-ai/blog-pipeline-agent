# Blog Pipeline Agent

Orchestrates end-to-end blog content creation from a single brief. The agent generates a batch of ideas, pauses for you to pick one, drafts a polished markdown post, writes matching image prompts, and produces a LinkedIn promo — all in one run, holding after the draft so nothing downstream is built from copy you have not signed off on.

**Install:** find Blog Pipeline Agent in the marketplace and add it to your workspace. No credentials are required; the agent uses the Cinatra platform to call its child agents.

**Configuration:** pass a `brief` (required) plus optional `audience`, `tone` (default: informative), `length` (default: medium), `referenceContent`, `companyUrl`, `blogPostUrl`, and `imageCount` (default: 1) when you start a run. The `projectId` and `cinatra_run_id` fields are set automatically by the platform.

**API contract:** inputs — `brief` (required), `audience`, `tone`, `length`, `referenceContent`, `companyUrl`, `blogPostUrl`, `imageCount`, `projectId`, `cinatra_run_id`; outputs — `ideas` array, `draft` object, `imagePrompts` array, `linkedinPost` string.

**Development:** clone the repo, then run `node extension-kind-gate.mjs` and `node renderer-binding-gate.mjs` to validate the extension before publishing.

**Review:** the run pauses twice — to pick an idea, and after the draft. The draft pause is a *hold*, not the decision: it stops the run before the LinkedIn projection and image prompts are derived from the draft, while approve / request changes / reject happens on the review step Cinatra opens for the generated draft. So the draft stage is two interactions: resolve the review step, then submit the pause to continue. No reviewer agent is installed.

**Troubleshooting:** a run sitting at the draft pause is the hold doing its job — resolve the run's review step, then submit the pause. If outputs are empty, verify that all four child agents (idea generator, draft writer, image prompt, LinkedIn writer) are installed.

## Works with

- Cinatra platform (Flow runtime; review gates come from the platform's artifact-lifecycle review, not from an agent this pipeline composes)

## Capabilities

- Generate a batch of distinct blog ideas from a short brief
- Draft the selected idea into a polished markdown post
- Write image prompts sized to the finished post
- Produce a LinkedIn promo tuned to the new article
- Hold for your idea choice, and again for the draft review, before advancing
