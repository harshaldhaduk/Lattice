# Competitive Landscape

## Where Lattice Sits in the Dev Tools Ecosystem

---

## Competitive Overview

The developer tools space is crowded, but no competitor addresses the specific intersection Lattice owns: **real-time, intent-aware coordination between multiple AI agents and human developers during active coding sessions.**

---

## Competitor Matrix

| Tool | Category | Real-time Presence | AI Agent Coordination | Intent Tracking | Pre-write Conflict Detection | Agent Negotiation | GitHub Sync |
|---|---|---|---|---|---|---|---|
| **GitHub** | Version control | No | No | No | No | No | Native |
| **VS Code Live Share** | Pair programming | Yes | No | No | No | No | External |
| **Cursor** | AI coding editor | Partial | No | No | No | No | External |
| **GitHub Copilot Workspace** | AI task planning | No | No | Partial | No | No | Native |
| **Linear / Jira** | Task management | No | No | High-level only | No | No | External |
| **Liveblocks** | Multiplayer infra | Yes | No | No | No | No | No |
| **Replit Multiplayer** | Browser IDE | Yes | No | No | No | No | External |
| **Devin** | Autonomous agent | No | No | No | No | No | External |
| **Lattice** | **Coordination layer** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |

---

## Detailed Competitive Analysis

### GitHub / Git

**What it does:** Durable version history, PR-based code review, branch management.

**Why it's not enough:** Git is a record of what happened. It has no concept of what is *about* to happen. By the time Git detects a conflict, the work is done and the collision has already occurred. PRs are reviewed after the fact, not before. Git was designed for asynchronous, human-paced workflows — not real-time parallel AI-assisted development.

**Lattice's angle:** We are not competing with GitHub. We sync into it cleanly. We are the layer that makes the *pre-GitHub* phase of building collaborative and safe.

---

### VS Code Live Share

**What it does:** Shared cursor, shared terminal, real-time co-editing in VS Code.

**Why it's not enough:** Live Share is designed for pair programming — one driver, one navigator, same screen. It has no concept of independent parallel work, no AI integration, no conflict prediction, and no intent layer. It is also a Microsoft product with limited extensibility for third-party coordination logic.

**Lattice's angle:** We support independent parallel work — multiple people doing different things simultaneously, each with their own AI agent. Live Share is a different use case (pair programming); Lattice is a different use case (parallel building).

---

### Cursor / GitHub Copilot / Claude Code

**What they do:** AI-powered coding assistance within a single developer's session.

**Why they're not enough:** Every AI coding tool today operates in isolation. Each agent knows the codebase, but not what other agents are doing. They cannot register intent, cannot detect that another agent is working on the same function, and cannot negotiate a resolution. They are powerful individual tools with a fundamental coordination blindspot.

**Lattice's angle:** We coordinate *between* these tools. A developer using Claude Code and a teammate using Cursor can both operate through Lattice's coordination layer, gaining visibility into each other's work without switching tools.

---

### GitHub Copilot Workspace

**What it does:** Multi-step task planning and execution within GitHub's interface.

**Why it's not enough:** Copilot Workspace is a single-user, GitHub-native planning tool. It doesn't handle real-time multi-agent coordination, doesn't integrate into the live coding flow, and has no agent negotiation capability. It's closer to a smart issue tracker than a coordination layer.

**Lattice's angle:** Copilot Workspace handles task planning. Lattice handles what happens during execution — in the IDE, in real time.

---

### Linear / Jira

**What they do:** Project management, task assignment, sprint tracking.

**Why they're not enough:** Task management tools operate at too high an abstraction level to catch real-time coding conflicts. There is no connection between a Linear ticket and the specific function being edited in VS Code. The latency (assign task → merge conflict 6 hours later) is the exact problem we solve.

**Lattice's angle:** Lattice is task-aware but file-and-function-scoped. We bridge the gap between "what are we building" and "what is being changed right now."

---

### Liveblocks / Yjs / CRDTs

**What they do:** Real-time collaborative data structures for building multiplayer apps.

**Why they're not enough:** These are infrastructure primitives — building blocks for multiplayer apps. They enable simultaneous editing of documents but have no semantic understanding of code. A CRDT doesn't know that two simultaneous edits to the same function signature will break the build. They also require building the entire product experience on top.

**Lattice's angle:** We use CRDT-like primitives internally where appropriate but wrap them in code-aware, intent-aware logic. We're a product, not a library.

---

## The White Space

No existing tool sits at this intersection:

```
Real-time + AI-agent-aware + Intent-tracking + Pre-write conflict detection
```

This is not a features gap (i.e., a competitor that needs to add a feature). It is a **conceptual gap** — existing tools were not designed for the world where multiple AI agents are running in parallel on a single codebase. That world arrived in 2025. The tooling hasn't caught up.

Lattice is built specifically for this new reality.

---

## Defensibility

**Short-term moat:** First-mover advantage in the AI-agent coordination category + network effects (the value increases as more team members connect)

**Medium-term moat:** Intent graph accumulates proprietary data about how AI agents work together effectively — becomes a training and optimization asset

**Long-term moat:** Deep IDE integration and established team workflows create high switching costs; expanding into enterprise developer platforms compounds this

---

## Potential Acquirers / Partners

- **Anthropic** — natural fit as MCP-native coordination layer for Claude Code teams
- **Microsoft / GitHub** — extension of GitHub's existing collaboration and Copilot investments
- **JetBrains** — coordination layer for their IDE ecosystem
- **Vercel / Linear** — dev tooling companies looking to own more of the workflow
