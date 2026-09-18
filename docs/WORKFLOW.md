# Feature sessions — 0.5.0

## Everyday use

Open your repository, click the Lattice icon on the left, and create a named session. Lattice fetches `origin/main` (or `lattice.baseBranch`), creates a `session/<name>-<id>` branch in a managed Git worktree, and opens it in another VS Code window. Your original checkout is preserved. Invite your teammate; Lattice prepares their GitHub clone, checks out the session base, and downloads the live workspace. Git credentials, dependencies and provider sign-ins stay local.

The center dashboard shows active/completed session cards, people, progress and linked PRs. The right sidebar focuses on people, prompts, pending decisions and session status. Plans, comments, memory and task tools are folded under details. The bottom composer keeps provider choice and prompt entry visible; permission/model/worktree controls live under More options.

Click a teammate's prompt or choose their agent conversation to guide that exact running turn. A session **Owner** can guide directly. An **Editor** submits a request the agent's human owner must approve. A **Viewer** cannot steer or run agents. Guidance uses the current executor's account. Codex and Claude support live guidance. Returning to My agent restores the draft you were composing in this window.

A terminal provider usage/rate-limit error creates a shared offer. A teammate clicks **Continue this task · your account**. The relay grants acceptance to one person, records a short handoff memory note, and the recipient runs on their own available provider. Shared code, plan, recent task transcript and fresh memory provide continuity; provider-private conversation state and account credentials are never transferred. Isolated worktree handoffs include a patch, capped at 120,000 characters, and require a matching Git base. If the recipient cannot start, the accepted task and note remain in history; its prompt can be retried from that record.

## What Git does

Git provides feature branches, recovery checkpoints, integration and PR publication. Live source edits travel through the shared relay; collaborators do not push or pull for each prompt. The relay therefore contains shared source, not just metadata.

The owner checks the base branch at safe turn boundaries. When it changes, Lattice freezes session writes, saves a Git recovery checkpoint (including new files), and merges into a separate candidate checkout. An available local agent can resolve conflicts there. Unresolved choices, missing checks, failed checks or changes that arrive during validation pause integration. Your working checkout is preserved. **Review update** opens the retained candidate, checks your reviewed resolution, or prepares a fresh candidate.

Validation uses configured `lattice.taskCheckCommand` executable/arguments, or detected `npm run typecheck` and `npm run test`. Configure an equivalent command for other project types. Dependencies must already be available; Node candidates reuse local `node_modules`. Automatic repair cannot silently grant expanded provider permissions or external actions. Its ordinary file edits are limited by the provider sandbox and explicit candidate permissions. Semantic questions can be presented to the owner.

The brain also shares active intents, plans, fresh memory and changed-file context across authorized sessions in the same repository. Overlapping prompts wait automatically, can be stopped, and reserve work atomically. Context refreshes during a turn. Agents are instructed to read it before edits; this is filename/task matching and context sharing, not a complete semantic dependency scheduler. Base reconciliation runs for open owner sessions; saved PRs are checked while a Lattice window is running. An offline owner cannot run automatic reconciliation.

## Finishing a session

**Finish → Create PR** waits for active turns to finish, reconciles the base and runs checks. You review the title, plan and full diff, then confirm **Publish PR**. Lattice rejects changes that arrive after validation or review, commits the reviewed files and pushes that exact commit. It creates or reuses a PR through your signed-in GitHub CLI. A create timeout is checked against GitHub before reporting an unknown outcome.

Review, approval and merge happen on GitHub. Lattice tracks the linked PR number; merged sessions appear in Completed, while closed-but-unmerged PRs are labeled separately. Tracking uses separate authenticated read connections and does not replace an active session connection. Offline GitHub/relay access leaves the last known card in place. Existing PRs can receive further reviewed pushes through Git/VS Code; branch protection on GitHub remains authoritative.

## Notes and practical boundaries

File comments and memory notes are pinned by file and content hash. When a file changes, moves or disappears, its notes are visibly marked stale. They remain available for review; stale memory is excluded from agent context. Reviewing a moved note asks for its current path and refreshes the anchor. Handoffs automatically append linked continuity notes.

No coordinator can guarantee zero semantic conflicts. Checked candidate integration prevents silent overwrite and catches failures covered by your checks; ambiguous design choices still need a person. Whole-file live-sync collisions preserve both workspaces and pause that file; they are not automatically reconciled by the Git base updater. Opt-in human CRDT editing handles simultaneous text changes in native buffers.

A reachable shared relay and GitHub repository access are required for teammates on different machines. The default localhost relay is for one machine. Current workspace limits remain 2,000 files / 32 MiB total / 512 KiB each. No paid-provider trial, real GitHub PR publication or production deployment is implied by fixture tests. See [feature coverage](FEATURE-COVERAGE.md) for remaining reference-product gaps.
