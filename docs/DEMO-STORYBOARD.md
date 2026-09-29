# Native VS Code demo — proposed storyboard

Status: superseded proposal, retained for historical context. The finished
0.5.11 demo uses native VS Code recordings, motion captions, a dark orange/blue
background, and recorded click/typing sounds. See the [current demo workflow](../scripts/demo/README.md).

## Recording specification

- Retain the previous export's 2560 × 1440 canvas and 25 fps.
- Approximately 120 seconds. No audio track, narration, music, captions, title cards, or added graphics in the top and bottom bands. Those bands remain solid black.
- Record native VS Code windows running Lattice. Do not reuse the browser-rendered editor from `scripts/demo/stage.html`.
- Use two isolated VS Code profiles as two demo participants. Show a single window at readable size for setup, and two windows side by side for collaboration. Keep the host on the left and guest on the right in paired shots.
- Use native participant names and branch labels to orient viewers. Pause on prompts and decisions long enough to read them. Cut loading delays, but retain the visible before/after of joining the workspace.
- Preserve live provider output and genuine relay behavior. Additional dashboard sessions must be real prepared sessions; activity shown as running must actually be running.

## Sample workspace

Use `relayboard-demo`, a small app that collects GitHub events and sends Slack notifications. It is separate from the extension source and prior sample markdown files.

Suggested files: `src/integrations/slack.ts`, `src/integrations/github.ts`, `src/integrations/linear.ts`, and corresponding tests. Keep the initial implementation short enough for edits to be legible.

Main session: **Slack notifications**, on its actual generated feature branch. Other prepared sessions: **GitHub activity feed** and **Linear issue sync**, each with separate branches and participants.

## Shot list

| Time | Native action | What the viewer can verify |
| --- | --- | --- |
| 0–8 s | Host opens the sample project and clicks Lattice in the activity bar. | Familiar VS Code explorer, small real codebase, Lattice entry point. |
| 8–20 s | Click New session, enter “Slack notifications,” slide coordination sensitivity from 4 to 8, then create. Copy the invitation. | One short setup flow; session branch opens in the same window. Requires the native slider prerequisite below. |
| 20–34 s | Cut to guest's clean profile. Install Lattice Sync from a downloaded VSIX, then open Lattice. | Actual installation, with the extension listing named Lattice Sync and product UI named Lattice. Keep the download/install beat brief. |
| 34–46 s | Paste the invitation and join. Hold on the empty explorer becoming the shared project, then open `slack.ts`. | Workspace arrives automatically in the same window; matching files and both participant names appear. |
| 46–61 s | Host submits: “In src/integrations/slack.ts, send every GitHub issue event to Slack. Add tests.” Guest opens the host's prompt and clicks Follow live edits. | Shared prompt, real streamed changes, moving cursor positioned at the edit. |
| 61–75 s | Guest clicks the host's prompt and sends: “Include the issue title and a clickable GitHub link.” Host clicks Allow guidance. | Role-based steering approval; the running agent incorporates the teammate's request. |
| 75–87 s | While host work is active, guest submits: “In src/integrations/slack.ts, send only critical issue events to Slack; ignore all other events.” | Directly opposing requirements on the same file; overlapping work visibly waits. Do not represent this as automatic semantic adjudication. |
| 87–104 s | Human stops the queued opposing run, sends the resolved direction to the host's agent, and approves that guidance: “Default to critical-only. Add an all-events option and test both modes.” | A person makes the product decision; the agent resumes with one clear requirement. Retain the actual approval state, not an invented conflict dialog. |
| 104–111 s | Hold on finished implementation and passing tests. | Concrete outcome of the collaboration, not only a conversation. |
| 111–120 s | Open the dashboard through the left activity bar. Show Slack notifications, GitHub activity feed, and Linear issue sync with actual branches and participants. Open one other session briefly if readable. | Multiple feature branches have their own working context. End on the real dashboard for a few seconds, then cut to black. |

## Prerequisites and limits discovered in the current build

1. **Native creation slider:** `App.tsx` currently gates the create/join sensitivity control to preview mode; the dashboard creation form has no slider. Expose and persist the control in the actual native creation route before recording the requested shot. Label it coordination sensitivity; it is not a model-quality setting.
2. **Human review:** overlapping prompt claims currently queue through `reserveWork`; they do not automatically present an opposing-requirements decision dialog. The storyboard above uses the existing steering approval flow for a real human decision. If the intended shot is automatic contradiction detection followed by a dedicated review dialog, that feature needs implementation and validation first.
3. **Installation:** the verified 0.5.6 distribution is the GitHub release VSIX. Use download → Install from VSIX unless the Marketplace version is independently verified before capture.
4. **Steering roles:** use an editor-role guest and an owner host so “Allow guidance” legitimately appears. Owner steering does not require approval. Steering stays on the target agent owner's provider account.
5. **Guest preparation:** joining must begin from a profile without the sample workspace. Configure any provider authentication off camera. Never film credentials or usable invitation secrets outside this disposable demo.
6. **Dashboard:** create the supporting sessions through real flows on the same sample repository. Session cards show people and branches; they are not evidence that every agent is currently working. Show an actual active prompt if that claim is part of the shot.
7. **Preflight:** rehearse stopping a queued prompt, applying guidance while the target provider is still running, guest workspace arrival, and dashboard navigation. Adjust timing to real behavior rather than injecting fabricated agent events.

## Editorial choices

End with passing tests and the dashboard: the payoff is a completed shared change alongside other focused work. PR creation, provider-limit handoff, and stale file notes belong in separate short demos so this silent walkthrough stays readable. Do not imply guaranteed absence of merge conflicts from live synchronization or overlap detection.

Before delivery, verify the export dimensions and frame rate, absence of any audio stream, plain black bands throughout, readable prompts, and genuine native VS Code footage. Keep the previous movie intact and export the new one under a distinct filename.
