# The Solution

## Momentum: Intent-Aware Coordination for AI-Native Development Teams

---

## Core Idea

Momentum is a **coordination runtime** that sits between your IDE, your AI agents, and your codebase. It does not replace GitHub, your editor, or your AI assistant. It adds a shared intelligence layer that every participant — human or AI — registers with before making changes.

Think of it as **air traffic control for a codebase under active construction.**

---

## The Central Insight

Current tools track **what changed**. Momentum tracks **why and where something is about to change**.

That single shift — from reactive to proactive — unlocks a class of problems that no existing tool can address:
- Conflict prediction before write
- Agent-to-agent negotiation before collision
- Intent-aware merge strategies
- Shared team context without async communication overhead

---

## How It Works

### Step 1: Developers Join a Momentum Session

Each developer opens the Momentum VS Code extension and connects to a shared session for their project. A presence panel shows who is online and what they're working on.

### Step 2: Tasks Are Registered as Intents

Before a developer (or AI agent) begins a task, they submit an **intent declaration**:
- Natural language task description: *"Refactor auth middleware to support OAuth2"*
- File scope: which files are expected to change
- Priority: blocking, normal, background

Momentum uses an LLM to parse the intent and create a structured **Intent Node** in the shared intent graph:
```json
{
  "id": "intent_017",
  "owner": "alice",
  "task": "Refactor auth middleware to support OAuth2",
  "files": ["src/auth/middleware.ts", "src/auth/types.ts"],
  "functions": ["verifyToken", "createSession"],
  "status": "in_progress",
  "timestamp": "2026-04-11T10:23:00Z"
}
```

### Step 3: Pre-Write Conflict Check

Before any file write is executed — whether by a human saving a file or an AI agent applying a patch — Momentum's coordination engine checks:

1. **File-level overlap**: Is this file in another active intent's scope?
2. **Function-level overlap**: Is this function being modified by another session?
3. **Dependency overlap**: Does this change affect something another intent depends on?

The engine returns one of three verdicts:

| Verdict | Meaning | Action |
|---|---|---|
| `SAFE` | No active conflicts detected | Apply change directly |
| `REVIEW` | Possible overlap, low confidence | Stage as shadow patch, notify team |
| `CONFLICT` | Active conflict with in-progress work | Trigger agent negotiation or escalate |

### Step 4: Agent-to-Agent Negotiation

When a conflict is detected between two AI agents, Momentum initiates an automated negotiation:

1. Each agent summarizes its intent and proposed change
2. The Momentum orchestrator (powered by Claude) evaluates:
   - Can the changes be sequenced? (Agent B waits for Agent A)
   - Can they be merged? (Parallel, non-overlapping edits to the same file)
   - Do they fundamentally conflict? (One refactors what the other is building on)
3. The orchestrator proposes a resolution:
   - A combined patch
   - A deferred order of operations
   - An escalation to the human developer

### Step 5: Shadow Patching

When a proposed change is uncertain, it is staged as a **shadow patch** — visible to the team but not yet applied:

- Shown as a diff preview in the IDE sidebar
- Tagged with the originating intent and agent
- Any team member can approve, reject, or modify
- Auto-expires after a configurable window if unclaimed

### Step 6: Human Approval for High-Stakes Changes

For changes that affect core interfaces, shared types, or high-traffic modules, Momentum requires explicit human sign-off before applying — ensuring that automation never silently breaks shared contracts.

### Step 7: Clean GitHub Sync

Once a Momentum session winds down, the sync engine:
- Collapses coordination noise into clean, meaningful commits
- Attaches intent metadata as commit messages or PR descriptions
- Pushes to the upstream GitHub repo
- Closes the coordination session cleanly

---

## Key Product Mechanics

### Intent Graph
A shared, live graph of all active tasks — what everyone is working on, which files they own, and what dependencies exist between their work. Visible to all team members in real time.

### Soft File Locking
Files are never hard-locked (which would destroy collaboration speed). Instead, Momentum uses soft locks: warnings that signal active ownership without blocking. A developer can always override — but they see the warning and make a conscious choice.

### Agent Communication Bus
A message channel where AI agents can post structured messages to each other:
- "I'm editing `verifyToken` in `auth/middleware.ts` to add a `scope` parameter"
- "My task depends on `verifyToken`'s signature — proposing we align first"
- "I've staged a shadow patch at path X — please review"

### Shared Workspace Memory
A persistent, session-scoped memory of decisions made, patches applied, and conflicts resolved. Agents and humans can query this context to avoid re-litigating decisions.

### Presence Panel
A VS Code sidebar panel showing:
- Active team members (online/offline)
- Current task per person
- Files currently being edited
- Pending shadow patches awaiting review
- Recent agent-to-agent communications

---

## What Momentum Is Not

| Not | Why |
|---|---|
| Not a Git replacement | Git remains the authoritative version control system. Momentum syncs cleanly into it. |
| Not a code editor | We work inside VS Code, not alongside it. |
| Not an AI coding tool | We coordinate AI agents — we don't replace them. |
| Not a project management tool | We're scoped to active coding sessions, not sprint planning. |

---

## Product Positioning

> **Momentum sits between "I have an idea" and "I push a commit" — making that space safe for multiple humans and AIs to build in simultaneously.**

The closest analogy: Git is the airport. PRs are the flight plan. **Momentum is air traffic control** — the real-time layer that ensures planes don't collide while they're still in the air.
