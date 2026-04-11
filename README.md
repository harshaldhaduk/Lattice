# Lattice

> **Build in parallel. Ship without conflict.**

Lattice is an AI-native coordination layer for VS Code that lets multiple developers and their AI agents work on the same codebase simultaneously — with shared intent tracking, real-time conflict detection, and automatic agent-to-agent negotiation before a single line is written.

---

## The Problem

Today, three developers working in parallel with AI agents are effectively flying blind. Each agent writes code without knowing what the others are doing. The result: merge conflicts, duplicated work, and broken assumptions discovered hours too late.

Git is a record of what changed. It does not prevent two agents from making incompatible changes to the same function at the same time.

## The Solution

Lattice sits inside your IDE and orchestrates parallel AI-assisted development:

- **Intent tracking** — every task is declared before work starts
- **Pre-write conflict detection** — changes are checked against active work before being applied
- **Agent-to-agent negotiation** — conflicting agents resolve overlap automatically, without human intervention
- **Shadow patching** — uncertain changes are staged for human review, not blindly applied
- **Clean GitHub sync** — sessions produce intentful commit history, not coordination noise

## How It Works

```
1. Developers join a shared Lattice session in VS Code
2. Each registers their current task as a structured intent
3. Before any agent writes a change → Lattice checks for conflicts
4. If conflict detected → agents negotiate a resolution automatically
5. Human approves when confidence is low or stakes are high
6. Session syncs cleanly to GitHub when done
```

## Quick Start

```bash
# Install the VS Code extension
# (search "Lattice" in VS Code Extensions marketplace)

# Start the coordination server
git clone https://github.com/Ekansh236/Monolith.git
cd lattice/server && npm install && npm run dev

# Open VS Code, click the Lattice icon in the sidebar
# Create a session and share the code with your teammates
```

## Architecture

```
VS Code Extension (TypeScript)
  ├── Presence Panel — who's online, what they're building
  ├── Intent Panel — live view of all active tasks
  ├── Patch Panel — pending shadow patches awaiting approval
  ├── File Save Interceptor — catches writes before they happen
  └── MCP Tool Server — Claude Code native integration

Coordination Backend (Node.js + Socket.io)
  ├── Session management
  ├── Intent graph (SQLite)
  ├── Conflict detection engine (file + function level)
  ├── Agent negotiation orchestrator (Claude claude-sonnet-4-6)
  └── Shadow patch service
```

## Tech Stack

- **TypeScript** — extension + backend
- **VS Code Extension API** — IDE integration
- **Socket.io** — real-time presence and coordination events
- **SQLite** — intent graph and session state
- **Anthropic Claude claude-sonnet-4-6** — agent negotiation and intent parsing
- **Model Context Protocol (MCP)** — native Claude Code integration
- **@babel/parser** — AST-level conflict detection
- **simple-git** — Git operations for shadow patching

## Documentation

| Doc | Description |
|---|---|
| [Overview](docs/overview.md) | Project vision, pitch, and core differentiators |
| [Problem](docs/problem.md) | Problem statement and why it matters now |
| [Solution](docs/solution.md) | How Lattice works |
| [Market](docs/market.md) | TAM/SAM/SOM and market timing |
| [Competitive Landscape](docs/competitive-landscape.md) | Where Lattice sits vs. existing tools |
| [Customers](docs/customers.md) | Target personas and customer journey |
| [Go-to-Market](docs/go-to-market.md) | GTM strategy and launch plan |
| [Monetization](docs/monetization.md) | Pricing tiers and revenue model |
| [Product Design](docs/product-design.md) | UX flows and interface design |
| [Technical Architecture](docs/technical-architecture.md) | System design and component breakdown |
| [Agent Coordination](docs/agent-coordination.md) | Agent protocol and negotiation design |
| [MVP](docs/mvp.md) | Hackathon scope and build plan |
| [Demo Script](docs/demo-script.md) | 30-sec and 2-min demo narratives |
| [Roadmap](docs/roadmap.md) | Post-hackathon path to startup viability |
| [Naming](docs/naming.md) | Project name rationale and taglines |

## Status

Built at [Hackathon Name] — April 2026.

---

*Lattice: The coordination layer for teams that build fast with AI.*
