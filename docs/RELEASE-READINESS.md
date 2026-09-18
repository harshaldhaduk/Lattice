# Release readiness — 0.5.0

This is an implemented and locally tested VS Code collaboration product. It is not yet a launched commercial service or a claim of complete reference product parity.

| Area | Implemented and verified | Boundary |
| --- | --- | --- |
| Text collaboration | Yjs character operations, concurrent writers, native unsaved buffers, reconnect replay | Explicit per-file opt-in for human edits; semantic conflicts still require human review |
| File synchronization | Automatic guest hydration, bidirectional workspace files, checksum conflict guards, trash for deletion | 2,000 files / 32 MiB total / 512 KiB each; GitHub history prepared for feature sessions; no file permissions or local runtime transfer; follow stream separately limited to 100 source files / 32k characters |
| Agent coordination | Atomic repository prompt reservations, automatic sequencing, refreshed team context, checked base reconciliation | File/word heuristics; agents must read refreshed context; no central planner, dependency scheduler or semantic conflict guarantee |
| Agents | Codex/Claude adapters, up to four local executors, separate worktrees, shared task registry and usage | Fixture runs validated concurrency; real paid generation remains a live trial |
| Handoffs/review | Shared context, reviewed patch transfer, isolated import, exact-patch review and optional required checks | Same Git base required for isolated patches; legacy snapshot-session patch handoffs remain limited; worktrees start at local HEAD; provider-private conversations are not migrated |
| Membership | Expiring/limited/revocable invitations, roles, verified GitHub identities and optional organization restriction | Hosted verification code is tested with a verifier fixture; real organization credentials have not been connected |
| History/memory | Persistent history, inverted keyword index, source-linked imports, membership-scoped search across sessions, saved sessions, archive/reopen/export | Cross-session search requires verified identity; retrieval is keyword-based rather than semantic |
| Storage/hosting | AES-256-GCM snapshots/backups, corruption/key rejection, container, TLS proxy configuration, health endpoint | Single host, 100 ms snapshot interval; host/domain and backup destination still required |
| Usage | Idempotent per-run usage, aggregate totals, reported-token budgets that stop executors | Does not reconcile provider invoices, enforce provider-side spend, or sell subscriptions |
| Distribution | Installable VSIX, repeatable builds, CI configuration, local Mac tests and Linux container | CI has not run in a remote repository; publisher credentials and Marketplace release are absent; Windows unverified |
| Interface | Left-side session dashboard, right-side people, compact bottom composer, native avatars interpolated between text positions, smooth live-follow caret, reduced motion | Native decorations cannot freely glide between pixels across lines; dedicated desktop shell and reference services are outside the VS Code implementation |

## Launch dependencies that require your environment

1. Hosting account/server and domain, plus a decision about GitHub organization restrictions.
2. A repository and Marketplace publisher identity for releases and automatic updates.
3. Provider billing/admin API access and a chosen payment processor if subscription sales and invoice reconciliation are required.
4. A real two-machine trial with signed-in providers, followed by longer load/soak testing and an independent security review before production commitments.

The software does not treat fixture tests as evidence of completed external deployment, paid-provider generation, audited security, or invoice accuracy.

0.5 adds owner/editor steering approval, terminal-limit handoff offers, stale pinned notes, checkpointed branch reconciliation and GitHub PR completion tracking. [Workflow](WORKFLOW.md) documents what runs automatically and what pauses for review.
