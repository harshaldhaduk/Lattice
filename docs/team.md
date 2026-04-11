# Team Composition & Role Assignments

## Team: UTA Team 7

Five-person team from UT Austin and Texas A&M, with complementary full-stack and ML backgrounds.

---

## Roster

| Name | Email | Role | Owns |
|---|---|---|---|
| Harshal Dhaduk | harshaldhaduk@utexas.edu | **Tech Lead / Backend** | Coordination server, WebSocket hub, SQLite schema, conflict detection engine |
| Rohan Karnik | rkarnik@utexas.edu | **VS Code Extension** | Extension scaffold, sidebar panels (Presence/Intent/Patches), file save interceptor, MCP Tool Server |
| LPS (Shyam) | lps@tamu.edu | **Agent Integration** | Negotiation orchestrator (Claude API), executor.ts worktree isolation, planner.ts decomposition |
| EA (Ekansh) | ea33649@eid.utexas.edu | **Frontend / Demo** | Sidebar webview React UI, conflict banner, diff preview, demo scenario scripting |
| Keerthi Chperla | kchperla@utexas.edu | **Infrastructure / Testing** | Docker, CI/CD, test suite, deployment, shared types package, demo hardening |

---

## Role Assignments by Build Phase

### Hour 0–3: Foundation
| Task | Owner |
|---|---|
| Init backend: Express + Socket.io + SQLite | Harshal |
| Init VS Code extension scaffold | Rohan |
| Define API contracts + WebSocket events | Harshal + Keerthi |
| Set up TypeScript monorepo + shared types | Keerthi |

### Hour 3–8: Core Infrastructure
| Task | Owner |
|---|---|
| Session create/join API + WebSocket rooms | Harshal |
| Intent registration API + DB write | Harshal |
| Real-time presence broadcast | Harshal |
| Sidebar panel: Presence tab (live) | Rohan + EA |

### Hour 8–14: Conflict Engine
| Task | Owner |
|---|---|
| File save interceptor (`onWillSaveTextDocument`) | Rohan |
| Pre-write conflict check API (file-level + AST) | Harshal + Shyam |
| Conflict warning banner in VS Code | EA |
| Shadow patch creation API + DB | Harshal |
| Patch approval UI in sidebar | EA |

### Hour 14–18: Agent Integration
| Task | Owner |
|---|---|
| MCP Tool Server (in-process in extension) | Rohan |
| `lattice_register_intent` MCP tool | Rohan |
| `lattice_check_edit` MCP tool | Rohan |
| `lattice_propose_patch` MCP tool | Rohan |
| Test with real Claude Code session | Shyam |

### Hour 18–22: Negotiation + Polish
| Task | Owner |
|---|---|
| Claude API negotiation call on CONFLICT | Shyam |
| Negotiation log panel (live WebSocket feed) | EA |
| Function-level AST conflict detection | Harshal |
| Intent auto-parsing with LLM | Shyam |
| Bug fixes + demo hardening | Keerthi |

### Hour 22–24: Demo Prep
| Task | Owner |
|---|---|
| Set up demo repo and scenario | EA + Shyam |
| Record backup demo video | Shyam |
| Rehearse live demo flow | All |
| Docker + CI final pass | Keerthi |
| Slide deck final pass | EA |

---

## Escalation Protocol

If an owner is blocked for >30 minutes:
1. Post in team chat with the blocker described in one sentence
2. Any available team member can unblock — ownership is about accountability, not exclusivity
3. Demo-critical items (interceptor, conflict check, MCP tools, negotiation) get team priority over everything else

---

## Why This Team Can Execute in 24 Hours

- **Harshal** has shipped production Node.js + WebSocket backends before — the server architecture is not exploratory
- **Rohan** has built VS Code extensions for course projects and knows the activation/webview lifecycle cold
- **Shyam** has prior experience with Anthropic's SDK and structured prompt engineering
- **EA** owns the frontend/demo and is the one who will run the live presentation — having the demo owner build the UI is intentional
- **Keerthi** keeps the build pipeline from falling apart and makes sure the demo doesn't crash due to environment issues

The plan is deliberately scoped to 29 hours of MUST-HAVE work for a 5-person team — that's under 6 hours per person for the critical path, leaving buffer for integration debugging.
