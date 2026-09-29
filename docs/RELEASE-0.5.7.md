# Lattice Sync 0.5.7

## Changes

- Add 12px gaps between Active/Completed, Start session/Cancel, and Join session/New session. Button rows wrap when needed.
- Automatically open the sender's live-agent view before provider edits begin.
- List review-ready branches and their PRs under Completed, without pretending they have been merged or archived.
- Keep Join live work to the right of its invitation field, with a separate hit target.
- Smooth white coordination slider, button hover/press feedback, and source staging that excludes local agent context metadata.

## What the video demonstrates

These are implemented extension workflows, not a substitute UI built for the recording:

| Workflow | Implementation and boundaries |
| --- | --- |
| Create a session and set strictness | Real feature-branch creation and persisted coordination sensitivity. The slider changes heuristic overlap detection, not model intelligence or a guaranteed conflict-prevention level. |
| Invite and join the workspace | Real relay membership and managed workspace hydration. Other machines need a reachable relay and repository access; dependencies and credentials stay local. |
| Prompt and follow live edits | Real provider adapters, sender auto-follow, shared files, and live cursor rendering. The recording's provider responses/file-writing sequence were scripted. |
| Steer a teammate's agent | Real targeted guidance and owner approval. Codex uses turn steering; Claude receives guidance through its active query. |
| Quota notification and task handoff | Real terminal-limit detection, one-winner acceptance, and continuation using the accepting teammate's local provider. The recording deliberately injected a quota failure. |
| Context continuity | Shares the task, workspace, plan, fresh notes, and bounded recent shared history. It does not transfer credentials, a subscription, private model state, or an unlimited full conversation. |
| Existing Codex/Claude sign-ins | Uses locally installed provider tooling and its authentication. Availability depends on that tooling and account access; Lattice does not grant a subscription. |
| Review and create a PR, then Completed | Real Git checks, reviewed-tree validation, commit/push and GitHub CLI PR creation/tracking. The recording used a local Git remote and a simulated GitHub PR response, not a published PR. Real use needs Git and authenticated `gh`. |

The two people were simulated in separate native VS Code windows on one machine.
Recordly camera zooms, overlapping-window choreography, captions, sounds, and the
black fade are video editing, not extension functionality.

## Validation

TypeScript checks, 57 automated tests, and browser workflow checks pass. Browser
checks measure the 12px button gaps at widths 375, 480, 768, 1024, and 1440px.
They also exercise filters, creation, join-button placement, steering, approval,
and handoff controls. Provider and GitHub protocol tests use fixtures.

A paid, authenticated provider turn and a genuine two-machine session with a
published GitHub PR have **not** been validated by the recording or this release.
Do not treat the demo as evidence of those external integrations succeeding.

Install `lattice-sync-0.5.7.vsix` and reload the VS Code window. This local package
does not itself publish an update to the Visual Studio Marketplace.
