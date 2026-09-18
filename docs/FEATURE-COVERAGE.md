# Feature coverage — 17 September 2026

**Lattice does not implement the entire reference product.** This audit compares the current source with the public homepage/product sections, all seven documentation guides, all ten linked blog articles, and the interactive demonstration. It distinguishes working functionality, partial matches and missing behavior. Demo screens are illustrative; they do not establish working backend services.

External research, original screenshots, source URLs and old packages are archived outside this project so they do not appear in extension details or shipped files. The implementation is a native VS Code extension, not a standalone desktop IDE.

## Collaboration and agents

| Requirement | Status | Implementation and boundary |
| --- | --- | --- |
| Shared sessions, visible teammates, agent activity and transcripts | Implemented | `src/relay/server.ts`, `src/webview/App.tsx`, `src/extension/native-presence.ts`; role-checked shared events and local editor presence. |
| Simultaneous Claude Code and Codex on each person's account | Implemented, fixture-tested | `src/providers/`, `src/extension/task-executor.ts`; one main agent plus isolated executors, up to four local runs. Actual paid generation and two-machine use were not verified in this audit. |
| CLI detection and local sign-in | Implemented | `Controller.connectProviders` opens the installed CLI login; provider-specific adapters run locally. |
| Automatic coordination MCP/hook installation | Missing | Coordination is passed in prompts and refreshed in `.lattice/session-context.json`; no public coordination MCP server or automatic CLI hook installer. |
| Pre-prompt overlap coordination | Partial | Atomic reservations automatically sequence overlapping prompts across authorized same-repository sessions. File/task heuristics and refreshed plans are implemented; complete semantic dependency analysis and agent tool hooks remain absent. |
| Continue solo when coordination fails | Different | Reservation renewal failure stops the local executor. New work requires the coordination capability; this is not fail-open execution. |
| Explicit prompt/chat intent and local account ownership | Partial | Shared chat and local provider prompting exist; no full reference composer intent/payer model. |
| Per-lane drafts and prompt queues | Partial | Switching agent lanes preserves drafts in the current window; one draft survives reload. Overlap waiting is cancellable. Durable independent lane/provider prompt queues remain absent. |
| Mid-turn steering | Implemented with limits | Codex and Claude support live guidance. Owner guidance is immediate; editors require the executor owner’s approval for each exact run. Failed send restores the composer draft; a complete rejected-guidance inbox is absent. |
| Shared approvals and first-response wins | Implemented | Relay and local provider callbacks bind approval to an active executor/run. Gating follows provider policy, not an independent rule requiring approval for every push/tool. |
| Safe-checkpoint takeover with one atomic winner | Partial | Terminal-limit takeover has an atomic acceptance and continuity note. Arbitrary live-turn takeover and provider-private state migration remain absent. |
| Automatic handoff on provider usage limit | Implemented with limits | Recognized terminal quota/rate errors create a one-click teammate offer. Main-workspace source and recent task context continue under the recipient account. Isolated patches are bounded and require matching Git bases. |
| Handoff preserving all prompts, patch and plan | Partial | Recent sender context and an optional reviewed patch transfer; patch import requires the same Git base. Shared session plan stays in the room. This is not complete conversation/checkpoint migration. |
| Isolated parallel work and reviewed integration | Partial | Real Git worktrees, diff review, optional configured checks, exact-patch validation and clean-checkout apply. Trees start at local HEAD, not the shared uncommitted snapshot; no automatic parent/child planning or combined result orchestration. |
| Interrupted external action with recorded unknown outcome | Partial | PR creation rechecks GitHub after an ambiguous response and reuses an existing matching PR. A general provider-tool external-action receipt/reconciliation service remains absent. |

## Workspace, records and administration

| Requirement | Status | Implementation and boundary |
| --- | --- | --- |
| Join without preparing a clone | Implemented | New feature sessions automatically clone accessible GitHub history, check out the base and hydrate live files. Legacy sessions retain snapshot hydration. Workspace bounds remain 2,000 files / 32 MiB / 512 KiB per file. |
| Git-remote snapshots with metadata-only coordination | Different architecture | Shared source and CRDT contents pass through and persist on the relay. No Git shadow-ref transport. Do not describe this relay as never holding source. |
| Concurrent human text editing | Implemented | Opt-in Yjs editing of native buffers, reconnect replay and conflict guards. Agent follow-stream limits: 100 documents / 32,000 characters each. |
| Conflict preservation and comparison | Partial | Dirty/checksum guards preserve live collisions. Base updates use recovery checkpoints, isolated merge candidates, agent repair, required checks and reviewable recovery. No guarantee of semantic compatibility or automatic whole-file live-collision resolution. |
| Pause on manual session branch changes | Partial | New branch-session prompts, restoring live workspaces, reconciliation and PR publication check the expected branch. Arbitrary external branch changes during an already-running provider remain outside a hard Git lock. |
| Native editor, explorer, terminal, search, problems and Git UI | Available through VS Code | These are local VS Code facilities. They are not shared terminal input ownership or synchronized multi-session panes. |
| Raw CLI mode with permission key passthrough | Missing as a session feature | Users may run CLIs in an ordinary VS Code terminal; it is not a shared lane tied to session approvals/history. |
| PR merge automatically completes session | Implemented | Exact linked PR tracking marks merged sessions complete and distinguishes closed-unmerged PRs. Polling needs an open Lattice window with access to the saved owner checkout, relay and GitHub CLI. |
| Multi-session dashboard, filters, alerts and progress | Partial | Left activity-bar icon opens center session cards, active/completed filters, search, people, pending approvals, progress and PR links. Full pane layouts and commercial capacity preflight remain absent. |
| Plans with ownership and status | Partial | Steps have owner and done flag; owner-controlled reassignment exists. No unowned/in-progress lifecycle, transfer offers or started-step consent flow. |
| Session/file/transcript/diff comments and conversion | Partial | File/line notes, resolution, stale content anchors and explicit review exist. Full range/hunk/transcript anchors and conversion to plan/prompt/subagent remain absent. |
| Shared file-linked memory and search | Implemented with limits | File memory, membership-scoped keyword search, stale anchors, explicit review and automatic linked handoff notes. Whole-file hash anchors are conservative; semantic anchor relocation remains absent. |
| Viewer, commenter, editor and owner | Partial | Server enforces viewer/editor/owner; commenter role and non-agent board assignments are absent. Roles are session-scoped, not a workspace-wide membership model. |
| Verified GitHub identities, invitations and organization restriction | Partial | Hosted mode validates GitHub identity and optional organization membership. Expiring/revocable role-based links exist; username-addressed workspace invitations and Git push-access checks are absent. |
| Secret redaction and encrypted persistence | Implemented with limits | Pattern redaction and AES-256-GCM snapshots/backups. Relay can read shared content. No claim of end-to-end encryption. |
| Organization-configured transcript retention | Missing | Bounded histories exist, but no time-based transcript retention policy/admin controls or complete workspace deletion lifecycle. |
| Bring-your-own provider usage | Implemented | Per-run cumulative usage and reported-token budgets. No invoice reconciliation, organization billing/keys or capacity-plan subscriptions. |
| Capacity fixed by host plan at creation | Missing | Resource bounds and local executor limit are not the documented commercial session-capacity model. |
| Reconnect, persistent history, archive/reopen/export | Implemented | Relay snapshots and stored credentials; practical recovery still depends on identity, relay availability and retained keys. |
| Signed standalone installers and automatic app updates | Missing | Local VSIX distribution; no Marketplace publication or standalone installer/update service. |

## Interactive demo coverage

The demonstration exposes additional interface concepts: board grid/list, sorting/search/filtering; session creation and review; role sharing; multiple panes; editor-first/agent-first layouts; collaborator focus; agent lanes/actions; permission modes; comments and conversions; child-task detail/review; terminal control; usage; settings for providers, members, enterprise keys, GitHub integration and retention.

Lattice supplies native editor/terminal/search/source-control facilities, the session sidebar, a local agent composer, usage, basic notes and worktree review. It does **not** reproduce the demo's complete pane/layout system, terminal leasing, settings administration, all composer actions or comment conversion workflows. The 0.5 release adds a session dashboard, branch/PR lifecycle and consent-based teammate steering. UI-only demo outcomes do not prove real authentication, billing, Git pushes or provider execution.

Some demo language conflicts with current documentation: organization-paid execution, enterprise keys, broad training/retention claims and consent-based steering of another person's agent appear in the mock, while current guides specify personal provider accounts and own-turn steering. These are separate illustrative concepts, not verified requirements silently treated as shipped features.

See [Workflow](WORKFLOW.md) for the 0.5 session lifecycle, Git’s role and coordination limits.

## Validation

The rename is checked with TypeScript, automated relay/provider/CRDT/workspace tests, browser preview interactions and native VS Code integration tests. Provider execution tests use fixtures. Passing tests demonstrates the listed local behavior; it does not establish deployment, full reference parity, a security audit or real paid-provider interoperability.
