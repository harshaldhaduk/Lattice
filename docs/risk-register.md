# Risk Register

## Hackathon Demo Risk Register

Consolidated technical risks with probability, impact, and mitigation for the live demo.

---

## Top 5 Technical Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| 1 | MCP Tool Server initialization fails inside VS Code extension | Medium | High | Scripted fallback: bypass MCP, trigger conflict check via REST API from a terminal curl command |
| 2 | Claude API negotiation takes >3 seconds during live demo | Medium | High | Pre-negotiate the demo scenario offline; cache the SEQUENCE resolution; show the result immediately |
| 3 | `onWillSaveTextDocument` `waitUntil` times out (VS Code enforces 1500ms deadline) | Low | High | Move heavy conflict check async: show a non-blocking warning banner and complete the check after save |
| 4 | AST function extraction fails on the demo file format | Low | Medium | Fall back to file-level conflict detection (still catches the conflict); label clearly in UI |
| 5 | SQLite DB corruption or lock under concurrent test writes | Low | High | Use WAL mode (already enabled); keep a clean backup `.db` file; restore in <30s if needed |

---

## Risk Detail

### Risk 1: MCP Tool Server in VS Code Extension

**What can go wrong:** The `@modelcontextprotocol/sdk` server running in-process inside the VS Code extension host may fail to initialize if the extension's activation event fires before the MCP server is ready, or if the in-process HTTP server port conflicts.

**Probability:** Medium — MCP in a VS Code extension is a non-standard pattern with known initialization quirks.

**Impact:** High — if Claude Code agents can't call `lattice_register_intent`, the main agentic demo loop breaks.

**Mitigation:**
- Primary: Add explicit initialization guard in extension `activate()` — wait for MCP server `listening` event before registering commands
- Fallback: REST API endpoints expose all the same operations. Claude Code agents can call the backend directly. Demo script includes a pre-written terminal command for each MCP tool call.
- Rehearse: Test the MCP initialization path 3+ times before the live demo

---

### Risk 2: Claude API Negotiation Latency

**What can go wrong:** The negotiation LLM call to Claude claude-sonnet-4-6 adds latency between "CONFLICT detected" and "resolution proposed." In a live 3-minute demo, a 5-second pause feels like the system crashed.

**Probability:** Medium — Anthropic's API typically responds in 1–3s for 512-token completions, but cold starts and rate limits are real.

**Impact:** High — visual dead time kills demo momentum.

**Mitigation (already implemented):** 8-second timeout in `negotiation.ts` — auto-escalates to ESCALATE verdict rather than hanging.

**Demo mitigation:**
- Pre-warm the API connection with a dummy request before the live demo
- Use a pre-recorded backup video of the negotiation step if latency exceeds 4s
- Present the negotiation as "Claude is thinking..." — reframe latency as a feature, not a bug

---

### Risk 3: `onWillSaveTextDocument` `waitUntil` Timeout

**What can go wrong:** VS Code enforces a hard 1500ms timeout on `waitUntil` promises in `onWillSaveTextDocument`. If the backend conflict check takes longer than 1500ms, VS Code cancels the wait and the file saves without the warning.

**Probability:** Low — the conflict check is a SQLite query plus in-memory set lookup (typically <50ms). But network latency to the backend can spike.

**Impact:** High — if the save goes through without the warning, the core demo behavior is invisible.

**Mitigation (already implemented):** The interceptor uses local session state (already synced via WebSocket) for the file-level check — no network round trip needed for the immediate warning. The REST check is a background verification.

---

### Risk 4: AST Parsing Failure on Demo Files

**What can go wrong:** `@babel/parser` may fail on certain TypeScript patterns (decorators, complex generics, template literals) in the demo repository's auth files.

**Probability:** Low — we control the demo repo files and can write them to be parser-friendly.

**Impact:** Medium — the demo degrades from function-level CONFLICT to file-level REVIEW, which is still a visible conflict detection.

**Mitigation:**
- Demo files (`src/auth/middleware.ts`) are pre-written to use simple TypeScript (no decorators, no complex generics)
- The `extractFunctionsFromSource` function silently returns `[]` on parse failure — the conflict detection still fires at the file level
- Test the demo file through the AST parser before the live demo

---

### Risk 5: SQLite DB Corruption or Lock

**What can go wrong:** Concurrent writes from multiple test agents could lock the SQLite WAL file, causing `SQLITE_BUSY` errors on subsequent writes.

**Probability:** Low — WAL mode allows concurrent reads + one writer; the demo involves at most 2 agents writing intents.

**Impact:** High — DB errors during the demo are catastrophic.

**Mitigation:**
- WAL mode is enabled in `db.ts` (`PRAGMA journal_mode = WAL`)
- Demo uses a freshly initialized DB (not the development `lattice.db`)
- Keep a backup `demo.db` pre-loaded with the demo session state; restore with `cp demo.db lattice.db` in <5s if needed

---

## Non-Demo Risks (Post-Hackathon)

| Risk | Mitigation |
|---|---|
| GitHub Copilot Workspace adds multi-session awareness | Lean into intent graph data flywheel and cross-session memory as proprietary moat (see differentiation.md) |
| Anthropic changes MCP protocol | MCP is an open standard; REST API fallback exists for all operations |
| SQLite doesn't scale beyond 10 concurrent sessions | Planned PostgreSQL migration in Phase 1 roadmap |
| VS Code Extension Marketplace approval delay | Submit for review on Day 0; distribute as `.vsix` directly to beta users in the interim |
