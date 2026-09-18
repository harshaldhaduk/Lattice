# Lattice

A shared coding session inside VS Code: teammates and live agent activity on the right, with one Codex/Claude composer in the bottom panel and a session dashboard opened from the left activity bar. Lattice is an independent VS Code collaboration extension.

The extension ID is `local-workbench.lattice`. Settings and commands use `lattice.*`; relay environment variables use `LATTICE_*`. See [upgrade notes](docs/UPGRADING.md) when moving from an earlier extension identity.

The interactive preview is available at http://127.0.0.1:4320 after `npm run preview`.

## Open it

1. Install `lattice-0.5.0.vsix` using **Extensions → … → Install from VSIX**. Requires VS Code 1.106 or newer. Reload the window after updating. Upgrade/restart the shared relay too; the new workspace and coordination features require protocol 3.
2. Open your GitHub repository. Click the **Lattice Sessions** icon on the left and choose **New session**. Give the feature a name; Lattice fetches the base branch and opens a dedicated feature branch in a new window.
3. Choose Codex or Claude Code in the bottom composer. Existing local CLI sign-ins are used; **Connect** opens provider setup/sign-in.
4. Use **Invite** to copy an editor or viewer invitation. For teammates on another machine, configure a reachable shared relay below first. Guests need repository access; Lattice prepares their clone and live files automatically.
5. Write your prompt. Click a teammate’s prompt to guide their agent. Owners can guide directly; editors need that agent owner’s approval. **My agent** returns to your own draft.
6. When finished, choose **Finish → Create PR**. Lattice reconciles, runs checks, shows the changes, and asks before committing/pushing. Review and merge on GitHub; Lattice tracks completion.

Git and a signed-in GitHub CLI (`gh`) are required for the branch/PR workflow. Automatic checks use `npm run typecheck` and/or `npm run test` when available, or the executable/arguments in `lattice.taskCheckCommand`. See [the workflow and its boundaries](docs/WORKFLOW.md).

Native VS Code lets you move views. If you previously moved the panels, use **View: Reset View Locations**, or drag **Session** to the right sidebar and **Agent** to the bottom panel.

## Implemented

Version 0.5 adds feature-branch sessions, the left-side dashboard, automatic overlap sequencing, checked base reconciliation, GitHub PR tracking, steering approvals, provider-limit handoffs and stale pinned notes. See [live workspace and coordination](docs/LIVE-WORKSPACE.md) for behavior, limits and architecture.

Version 0.3 adds character-level collaboration, offline edit replay, native file rename/deletion propagation, up to four local agents, verified GitHub membership for hosted relays, expiring/revocable invitations, encrypted storage, searchable history/memory, task context/patch handoffs, session budgets, and a tested relay container.

Use **Session tools** in the sidebar for search, memory import, invite management, budgets, archive/reopen, export, recovery, and saved sessions. Use **Edit together** on each participant’s clean copy of the same source file to merge simultaneous unsaved edits. Turn on **Worktree** in the composer to launch an independent agent while another runs; each task has its own stop control and reviewable checkout.

- Named sessions, invitation links, editor/viewer roles, reconnectable membership and persistent relay state.
- Live teammate file/line presence, GitHub profile photos in the sidebar, native file badges, and avatar markers beside the active line.
- Live agent edits and new source files stream between teammates. Compatible local files update automatically; dirty or divergent files pause individually.
- **Follow live edits** opens an editor view with a smoothly moving avatar/caret, typing indicator, automatic scrolling, and pause/resume following.
- Streaming Codex and Claude conversations in one bottom panel, provider/model selection, read-only and normal permission modes, stop, and live steering for both providers.
- Select a teammate’s agent to read its transcript, send guidance, or request stopping its active run. The executor and account remain on the teammate’s machine. Editors require the agent owner’s approval; the session owner can guide directly.
- Shared approval cards, tool/activity logs, per-person token counts, and provider-reported costs where supplied.
- Shared plans, file-pinned notes that become stale when their code changes, and automatic handoff continuity notes.
- Provider-limit offers let a teammate accept once and continue with their own provider account.
- Repository session context, automatically sequenced overlapping prompts, and checkpointed base-branch reconciliation with required checks.
- Separate Git worktrees for agent tasks. Review the exact patch before integrating into a clean checkout. Integration leaves changes uncommitted.
- Optional **File changes** offers exact-version diff review and manual application of saved tracked files.
- Composer drafts survive webview reloads. Shared plan/memory and peer activity are included in new agent prompts.

### Live agent collaboration

The host opens a project and starts a session. Joining downloads the session’s files into a managed local folder and opens it in a new VS Code window; guests do not need to clone or pull manually. Run an agent from the bottom panel. Teammates can click **Follow live edits** beneath that agent to watch the source change and its avatar move. Native editors also receive compatible changes and show participant avatars.

Native editor avatars now interpolate between incoming line/column positions over 160 ms. They track both teammate cursors and main-checkout agent edits, without changing your selection or file contents. Large navigation jumps snap immediately. Set `lattice.animatePresence` to `false`, or **Workbench: Reduce Motion** to **on**, to disable interpolation. The public VS Code decoration API limits this movement to text positions; unrestricted pixel-smooth movement across lines remains in the **Live agent** view. The native renderer does not patch VS Code or inject workbench CSS.

**Pause sync** stops source publishing and automatic local application for your workspace. Following remains available. Dirty files, divergent content and save-hook changes pause synchronization for that file; resolve the local difference before resuming. Worktree edits stream into the follow view and remain isolated from other main checkouts.

Updates reflect actual editor/filesystem changes. Some provider tools write complete blocks at once; cursor interpolation is smooth, but this does not invent a token-by-token stream. Current limits: 100 live source files per session, 32,000 characters per file, and common text/source extensions. Git-ignored files, dependency/build directories, editor/tool settings and environment files are excluded from automatic source publishing.

Agent text updates merge with concurrent updates using Yjs. Human collaboration is explicitly enabled per file; its normal unsaved buffers merge and retain VS Code undo behavior. Files outside that mode continue to protect unsaved edits. Offline edits replay after reconnection while the window remains open; after a crash, **Recover pending collaborative edits** opens the saved text for recovery. **Pause sync** pauses both modes.

Live-workspace renames synchronize as creation/deletion, guarded by prior checksums. Received deletions use the system trash. A fresh join downloads the current snapshot; reconnecting reconciles the saved baseline and preserves overlapping local edits. Legacy sessions without workspace snapshots use the existing guarded native rename/delete path. Worktree changes remain isolated until integration.

See [implementation architecture](docs/IMPLEMENTATION.md) and [release readiness](docs/RELEASE-READINESS.md) for exact scope and remaining launch dependencies.

## Invite teammates on another machine

Each teammate needs this extension and their own signed-in provider CLI to run agents. Only the host needs the project beforehand; guests need access to the GitHub repository and receive its live workspace automatically. Dependencies and runtime setup remain local. Start a relay reachable by everyone on a private network or tailnet:

```sh
npm ci
npm run build
HOST=0.0.0.0 PORT=4319 LATTICE_DATA_DIR="$PWD/.lattice-relay" node dist/relay.cjs
```

On each machine, set this in VS Code user settings, using the relay machine’s actual reachable address:

```json
{
  "lattice.relayUrl": "ws://YOUR-RELAY-ADDRESS:4319"
}
```

Then start the session and copy its invitation. A `127.0.0.1` invitation only works on the relay machine. For internet hosting, configure a TLS reverse proxy and use `wss://`; this repository does not deploy hosting automatically. `lattice.advertiseUrl` can override the address placed in invitations when the host connects through a different address.

Invitations expire after 24 hours by default and allow 31 joins; owners can revoke them in Session tools. Established memberships survive invite expiry. The default local relay uses display names and restricted JSON files. The hosted configuration verifies GitHub identities on every connection, optionally restricts access to one GitHub organization, and encrypts snapshots and backups with AES-256-GCM. Encryption at rest protects stored files; the relay can read session content. Editors may approve and stop one another’s agents. Leave `lattice.shareTranscripts` enabled for the shared transcript UI; disabling it suppresses agent/tool text sharing, while prompts, presence, status, approvals and usage remain shared.

For a hosted deployment, follow [the deployment guide](docs/DEPLOYMENT.md). In VS Code set your `wss://` relay URL and run **Lattice: Sign In to Relay**. A token is sent only to that explicitly connected relay address.

For required worktree checks, set `lattice.taskCheckCommand` to an executable and its arguments, for example `["npm", "test"]`. **Run checks** must pass on the exact patch before **Integrate**. **Hand off** transfers a reviewed patch and recent conversation context; the recipient imports it into a fresh worktree at the same Git base.

Budgets use provider-reported cumulative usage, deduplicated per task. They stop local agents and prevent new runs when the reported limit is reached. Reporting can lag actual execution; these are coordination budgets, not provider billing enforcement.

## Local development and preview

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run preview
```

With the preview running, `npm run test:ui` runs the Chrome interaction checks (`CHROME_PATH` overrides the executable).

Open **http://127.0.0.1:4320** for the interactive visual preview. It uses clearly labeled sample participants and never invokes a model. In VS Code, press **F5** to launch the actual extension in a development host. `npm run package` creates the installable VSIX.

The source is split into `src/extension`, `src/providers`, `src/relay`, `src/shared`, and `src/webview`. Credentials remain with the installed provider CLIs; session reconnection tokens use VS Code SecretStorage. Only the first workspace folder is supported.

## Verification

- TypeScript check and forty automated tests: relay authorization/state/reconnects/persistence, targeted guidance, provider protocol adapters, worktree patch application, file review guards, CRDT convergence, 24 concurrent clients, identity binding, invite lifecycle, encrypted storage, parallel usage, budgets, archiving, membership-scoped memory search, native presence interpolation, no-clone workspace hydration/sync, and atomic conflict reservations.
- Browser interaction checks: dashboard search/filters, feature-session creation, compact composer, per-lane draft retention, Claude guidance, owner approval cards, provider-limit offers, and the existing plan/invitation flows.
- Conflict sensitivity slider, saved preference and live-workspace join onboarding are covered by browser checks. `npm run test:workspace` checks managed-folder hydration, resume credentials, native unsaved typing, incoming host files and refreshed agent context in VS Code. Unit checks also cover bulk downloads while sync is paused, binary files, exclusions and stale-write rejection.
- Native branch workflow: automatic guest Git preparation, matching session base/branch, hydration of uncommitted live work, preserved main checkout, new-window credentials and cancellation of queued overlapping prompts. Run `npm run test:branch-workflow`.
- Separate VS Code profile checks: extension activation, both native webviews, session creation, shared plan round trip, invitation controls.
- Native VS Code integration test across two temporary checkouts: live updates, new files, protection of unsaved buffers (including macOS path aliases), conflict recovery, concurrent unsaved edits, offline replay, file rename/deletion, and two simultaneous local task executors with isolated files and separate usage. Agent executors use fixture processes, not paid inference.
- Browser live-view checks: incoming code, moving cursor, transform interpolation, pause/resume and reduced-motion support. Run `npm run test:live-ui` with the preview server running.
- Native avatar checks: run `npm run test:native-presence` on macOS with VS Code installed (`VSCODE_EXECUTABLE` overrides the executable). A separate test profile checks actual editor rendering, intermediate positions, agent tracking, unsaved edits, reduced motion, and cleanup after switching files or disconnecting. Screenshots and results are saved in `artifacts/native-presence-*`.
- Installed Codex and Claude SDK handshakes and model discovery. No paid model turn was run during validation; authenticated generation and cross-machine networking still need a live session check.
- Docker image built and exercised: healthy startup, required GitHub authentication, anonymous-client rejection and a non-root runtime. `node scripts/verify-container.mjs` repeats the smoke check after building the image.

## Feature coverage

See [feature coverage](docs/FEATURE-COVERAGE.md) for implemented capabilities and remaining gaps.
