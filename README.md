# Blog Pipeline Agent

Turns one blog idea your organisation already holds into a finished post with its featured image and the LinkedIn post that announces it. You give a brief, pick one idea no draft has used yet, pick the brand voice it is written in, wait while the post and its picture are made, review the post while the run waits, and approve the LinkedIn post.

**Install:** find Blog Pipeline Agent in the marketplace and add it to your workspace. No credentials are required; the agent uses the Cinatra platform to call its child agents.

**Configuration:** pass a `brief` (required) plus optional `audience`, `tone` (default: informative), `length` (default: medium), `referenceContent` and `ideaCount` (default: 5). `companyUrl`, `blogPostUrl`, `projectId` and `cinatra_run_id` are set by the platform and are not shown.

**API contract:** inputs — `brief` (required), `audience`, `tone`, `length`, `referenceContent`, `ideaCount`, `companyUrl`, `blogPostUrl`, `projectId`, `cinatra_run_id`; outputs — `linkedinPost`, `linkedinTitle`. The post is written while the run is going, so it is an artifact of its own and not a run output.

**Development:** run `node extension-kind-gate.mjs`, `node renderer-binding-gate.mjs` and `npm test` before publishing.

**Review:** the run pauses four times — to pick an idea, to pick the brand voice the post is written in, to review what the run made, and to approve the LinkedIn post. The middle pause names the revisions the run minted, so the review opens on exactly those, one per thing, and the run waits until the last is decided. This flow owns the pause, not the decision.

**Troubleshooting:** a run stopping at the idea step with a sentence instead of a list has no idea left to draft — every stored idea has a draft or is reserved; generate new ideas and start again. A run sitting at the review is the pause doing its job: decide the review card, then continue.

## Works with

- Cinatra platform (Flow runtime; the review card and its decision come from the platform, not from an agent this pipeline composes)

## Capabilities

- Offer the blog ideas no draft has used, and reserve the one you pick
- Hold for the brand voice the post is written in, and hand that one pick to the writer
- Draft it into a markdown post, written as an artifact while the run is going
- Make the post's featured image
- Open the review on exactly the revisions the run made, and wait there
- Produce a LinkedIn post, and hold for your approval
