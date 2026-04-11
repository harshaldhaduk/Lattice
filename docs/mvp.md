# MVP Scope

## What We Build for the Hackathon

---

## MVP Guiding Principle

**The hackathon MVP must be demoable, not just describable.**

Every feature we build must be visible in a live 3-minute demo. Features that require explanation but can't be shown should be deferred. The MVP must demonstrate the core loop: two agents trying to edit the same code, a conflict caught in real time, and a resolution reached without breaking either agent's work.

---

## The Core Demo Loop (Must-Have)

These six things must work perfectly in the demo:

1. **Two developers join a shared Lattice session** in VS Code
2. **Each declares an intent** (natural language task description)
3. **One developer's AI agent attempts to edit a file** that the other agent has claimed
4. **Lattice catches the conflict** before the write is applied
5. **Agents negotiate** and one is deferred to a shadow patch
6. **Human approves the shadow patch** and it's applied cleanly

If these six things work, the demo is compelling. Everything else is bonus.

---

## MVP Feature Set

### MUST HAVE (Core Loop)

| Feature | Description | Effort |
|---|---|---|
| Session creation + join | Generate a session code; other developers join via extension | 2h |
| Presence panel | See who is in the session and their current task | 2h |
| Intent registration | Text input → creates intent node with file scope | 3h |
| File save interception | VS Code hook catches saves before applying | 2h |
| Conflict detection (file-level) | Check if saved file is in another intent's scope | 2h |
| Conflict warning banner | Non-blocking notification with options | 2h |
| Shadow patch creation | Stage a change as pending instead of applying | 3h |
| Patch approval UI | Sidebar panel with diff preview, approve/reject | 3h |
| Agent communication via MCP | Expose intent + check tools as MCP tools for Claude Code | 4h |
| Agent negotiation (basic) | Claude API call to propose resolution when conflict detected | 3h |
| Real-time sync (WebSocket) | All state changes broadcast to all session participants | 3h |

**Total MUST HAVE: ~29 engineering hours**

---

### SHOULD HAVE (Makes Demo Much Better)

| Feature | Description | Effort |
|---|---|---|
| Negotiation log panel | Visible feed of agent-to-agent messages | 2h |
| Inline file indicators | Gutter icons showing who owns each file | 2h |
| Function-level conflict detection | AST parsing to detect same-function conflicts | 4h |
| Intent auto-parsing (LLM) | LLM parses task description to infer file scope | 2h |
| Session summary view | Shows what happened in the session on close | 2h |

**Total SHOULD HAVE: ~12 engineering hours**

---

### NICE TO HAVE (Post-Hackathon)

| Feature | Description | Effort |
|---|---|---|
| GitHub sync | Clean commit with intent metadata | 4h |
| Dependency conflict detection | Graph-based check for indirect conflicts | 8h |
| Multi-agent parallel negotiation | 3+ agents negotiating simultaneously | 6h |
| JetBrains plugin | Same extension for IntelliJ/WebStorm | 12h |
| Web dashboard | Session history and analytics | 8h |

---

## MVP Architecture (Simplified)

```
VS Code Extension (TypeScript)
  ├── Webview panel (Presence + Intent + Patches)
  ├── File save listener (onDidSaveTextDocument)
  ├── Socket.io client
  └── MCP Tool Server (in-process)

Coordination Backend (Node.js + Express + Socket.io)
  ├── Session routes (create, join)
  ├── Intent routes (register, list, complete)
  ├── Edit check route (pre-write conflict)
  ├── Patch routes (create, approve, reject)
  ├── WebSocket hub (Socket.io rooms)
  └── SQLite database (via better-sqlite3)

Negotiation Service
  └── Anthropic Claude claude-sonnet-4-6 API call (on CONFLICT verdict)
```

---

## Build Plan (24-Hour Hackathon)

### Hour 0–3: Foundation
- [ ] Init backend: Express + Socket.io + SQLite schema
- [ ] Init VS Code extension: scaffold with yo code
- [ ] Define all API contracts and WebSocket events
- [ ] Set up TypeScript monorepo with shared types package

### Hour 3–8: Core Infrastructure
- [ ] Session create/join API + WebSocket rooms
- [ ] Intent registration API + DB write
- [ ] Real-time presence broadcast
- [ ] Sidebar panel: Presence tab (live, connected)

### Hour 8–14: Conflict Engine
- [ ] File save interceptor in VS Code extension
- [ ] Pre-write conflict check API (file-level)
- [ ] Conflict warning banner in VS Code
- [ ] Shadow patch creation API + DB
- [ ] Patch approval UI in sidebar

### Hour 14–18: Agent Integration
- [ ] MCP Tool Server (in-process in extension)
- [ ] `lattice_register_intent` MCP tool
- [ ] `lattice_check_edit` MCP tool
- [ ] `lattice_propose_patch` MCP tool
- [ ] Test with real Claude Code session

### Hour 18–22: Negotiation + Polish
- [ ] Claude API negotiation call on CONFLICT
- [ ] Negotiation log panel
- [ ] Function-level conflict detection (AST)
- [ ] Intent auto-parsing with LLM
- [ ] Bug fixes + demo hardening

### Hour 22–24: Demo Prep
- [ ] Set up demo repo and scenario
- [ ] Record backup demo video
- [ ] Rehearse live demo flow
- [ ] Slide deck final pass

---

## Demo Repo Setup

The demo uses a pre-built repository with:
- A `src/auth/middleware.ts` file with `verifyToken()` and `createSession()`
- A `src/api/routes.ts` file that consumes the auth functions
- Pre-written agent prompts that will trigger the conflict scenario

Agent A prompt: *"Add OAuth2 scope support to verifyToken — add a scope?: string[] parameter and validate it"*

Agent B prompt: *"Add rate limiting to the auth middleware — check the return value of verifyToken and add a call counter"*

Both tasks touch `verifyToken`. The conflict is caught. The demo runs.

---

## Definition of Done (Hackathon Submission)

- [ ] Two developers can join a session and see each other's presence
- [ ] Each can register a task intent with file scope
- [ ] A file save by one agent is caught when it conflicts with another's intent
- [ ] Conflict warning is shown with context about the other intent
- [ ] Shadow patch is created and visible in the sidebar
- [ ] Second developer can approve the shadow patch
- [ ] Agent negotiation produces a visible resolution message
- [ ] MCP tools work end-to-end with a real Claude Code session
- [ ] Live demo runs without crashing for 3 minutes
- [ ] All code is committed to GitHub with a clean README
