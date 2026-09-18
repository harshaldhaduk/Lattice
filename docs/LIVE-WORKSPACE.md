# Live workspace and coordination — 0.5

The branch/PR user flow is described in [Workflow](WORKFLOW.md). Git backs sessions and recovery; live files travel over the relay.

`SessionWorkspace` connects native editors and the filesystem to `WorkspaceMirror`, which persists per-file baselines. Joining a feature session prepares its GitHub history and session base before live hydration. Older sessions without branch metadata still hydrate into an independent Git snapshot. Git authentication, dependencies and runtime setup remain local.

Initial hydration completes even when ongoing sync is paused. Resume reconciles saved baselines and preserves local divergence. Writes compare previous checksums both at the relay and before applying to native buffers. Deletions use trash; renames travel as creation/deletion. Whole-file conflicts pause rather than silently overwrite. Explicit **Edit together** provides character-level collaboration.

Limits are 2,000 files, 32 MiB total and 512 KiB per file. Git-ignored files, dependencies/build outputs, Git history, editor/agent settings, credential paths and symlinks are excluded. File permissions/executable bits are not transferred. Agent follow streams separately support 100 source documents and 32,000 characters per document.

Before agents start, atomic reservations compare file names and task wording against authorized active repository sessions. Overlapping prompts wait automatically; Stop cancels waiting. Reservations expire after 90 seconds, renew every 25 seconds and release on completion/disconnection. Losing coordination stops the executor. This is heuristic overlap detection, not guaranteed semantic analysis.

`LiveTeamContext` refreshes `.lattice/session-context.json` after current-session or repository-context changes. Plans, active work, fresh memory and changed-file metadata are marked as untrusted teammate data. Agents are instructed to read it before edits and next steps. The file refreshes automatically; the running model must read it to learn changes. Runtime context is excluded from sharing and Git.

Feature-branch integration is automatic at safe turn boundaries on the owner's machine. Failed or ambiguous candidates remain reviewable; required checks and late-edit guards protect the live checkout. Independent agent task worktrees still begin at local Git HEAD. Use the main session workspace for live work on uncommitted shared files.

Unit tests, browser interaction tests and native VS Code integration tests cover these local paths. Provider execution and GitHub lifecycle tests use fixtures; a real two-machine/provider trial remains separate.
