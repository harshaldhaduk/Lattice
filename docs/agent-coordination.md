# Agent Coordination Protocol

## How Momentum Enables AI Agents to Collaborate Without Collision

---

## The Core Challenge

AI coding agents (Claude Code, Cursor, Codex, etc.) are powerful but context-blind by default. Each operates in its own session with knowledge of the codebase, but no awareness of:

- What other agents are currently doing
- Which files or functions are being actively modified
- What the intent or goal of another agent's task is
- Whether their proposed change will conflict with work in progress

Momentum solves this by giving every agent access to a shared coordination layer through **three integration mechanisms**:

1. **MCP tools** (for Claude Code and any MCP-compatible agent)
2. **REST API** (for agents that can make HTTP calls)
3. **VS Code Extension hooks** (for agents operating within VS Code)

---

## The Agent Lifecycle in Momentum

Every agent-driven task follows this lifecycle:

```
REGISTER → CHECK → EXECUTE or STAGE → COMMUNICATE → COMPLETE
```

### Phase 1: REGISTER — Declare Intent Before Starting

Before an agent begins a task, it registers its intent with Momentum:

```
Tool: momentum_register_intent
Input: {
  "task": "Refactor auth middleware to support OAuth2 scopes",
  "files": ["src/auth/middleware.ts", "src/auth/types.ts"],
  "functions": ["verifyToken", "createSession", "AuthMiddlewareOptions"],
  "priority": "normal",
  "estimatedDuration": "15m"
}

Response: {
  "intentId": "intent_017",
  "status": "registered",
  "conflicts": [],
  "message": "Intent registered. No active conflicts detected."
}
```

The intent is broadcast to all session participants in real time. Other agents and developers immediately see that `verifyToken` and `createSession` are claimed.

---

### Phase 2: CHECK — Pre-Write Verification

Before applying any file change, the agent calls:

```
Tool: momentum_check_edit
Input: {
  "intentId": "intent_017",
  "filePath": "src/auth/middleware.ts",
  "diff": "--- a/src/auth/middleware.ts\n+++ b/src/auth/middleware.ts\n@@ -12,7 +12,9 @@\n-function verifyToken(token: string): boolean {\n+function verifyToken(token: string, scope?: string[]): boolean {",
  "modifiedFunctions": ["verifyToken"]
}

Response: {
  "verdict": "CONFLICT",
  "conflictingIntent": {
    "id": "intent_019",
    "owner": "bob-agent",
    "task": "Add rate limiting to auth endpoints",
    "conflictingFunctions": ["verifyToken"],
    "status": "in_progress"
  },
  "recommendation": "NEGOTIATE",
  "message": "bob-agent is currently modifying verifyToken for rate limiting. Initiating negotiation."
}
```

---

### Phase 3: EXECUTE or STAGE — Based on Verdict

**If `SAFE`:** Agent applies the change directly and notifies Momentum:
```
Tool: momentum_complete_edit
Input: { "intentId": "intent_017", "filePath": "...", "changeApplied": true }
```

**If `REVIEW`:** Agent stages the change as a shadow patch:
```
Tool: momentum_propose_patch
Input: {
  "intentId": "intent_017",
  "filePath": "src/auth/middleware.ts",
  "diff": "...",
  "reason": "Modifying verifyToken signature — bob's agent is nearby, requesting human confirmation"
}
Response: { "patchId": "patch_042", "status": "pending", "notifiedParticipants": ["bob", "alice"] }
```

**If `CONFLICT`:** Agent enters negotiation phase (see Phase 4).

---

### Phase 4: COMMUNICATE — Agent-to-Agent Negotiation

When a conflict is detected, Momentum's negotiation orchestrator:

1. **Collects context** from both agents:
   - Agent A's intent, proposed diff, and reasoning
   - Agent B's intent, in-progress state, and dependencies

2. **Sends a structured negotiation message** to each agent:
```json
{
  "type": "NEGOTIATION_REQUEST",
  "from": "momentum-orchestrator",
  "conflict": {
    "function": "verifyToken",
    "agentA": { "intent": "Add OAuth2 scope param to verifyToken", "owner": "alice" },
    "agentB": { "intent": "Read verifyToken return value for rate limit check", "owner": "bob" }
  },
  "question": "Can you sequence your work so agentA modifies the signature first, then agentB adapts its rate limiter? Or do you need them merged into a single change?"
}
```

3. **Agents respond** with their preferred resolution:
```json
{
  "agentA_response": "I can complete verifyToken first. Estimated: 3 minutes.",
  "agentB_response": "Agreed. I'll pause verifyToken work and continue on the middleware wrapper instead."
}
```

4. **Orchestrator produces a resolution**:
```json
{
  "resolution": "SEQUENCE",
  "order": ["agent-alice: verifyToken signature", "agent-bob: rate limiter adaptation"],
  "estimatedHandoffTime": "3m",
  "notifications": [
    { "to": "bob", "message": "Your agent is deferring verifyToken work. Alice's agent completes in ~3 min." },
    { "to": "alice", "message": "Proceed with verifyToken. Bob's agent will adapt afterward." }
  ]
}
```

---

### Phase 5: COMPLETE — Intent Closure

When an agent finishes its task:

```
Tool: momentum_complete_intent
Input: { "intentId": "intent_017", "summary": "Refactored verifyToken and createSession for OAuth2 scope support. Added scope?: string[] parameter to both functions." }
```

This:
- Releases all file/function claims
- Notifies other agents that their blocked work can resume
- Logs completion to the shared workspace memory
- Unblocks any pending patches that were waiting on this intent

---

## Negotiation Prompt Design

The orchestrator uses the following prompt structure when invoking Claude for negotiation:

```
You are a code coordination mediator for a team of AI coding agents.
Two agents have a conflict. Your job is to propose the best resolution.

AGENT A:
- Name: alice-agent
- Task: "Refactor auth middleware to support OAuth2 scopes"
- Conflicting change: Modifying verifyToken() signature to add scope?: string[] parameter
- Status: Ready to apply

AGENT B:
- Name: bob-agent  
- Task: "Add rate limiting to auth endpoints"
- Conflict: Reads return value of verifyToken() and depends on its current signature
- Status: Mid-implementation

CONFLICT: Both agents need to modify verifyToken() but for incompatible reasons.

RESOLUTION OPTIONS:
1. SEQUENCE: Agent A completes first; Agent B adapts to new signature
2. PARALLEL: Agents work on different functions (do they actually conflict at function level?)
3. MERGE: Combine both changes into a single coordinated patch
4. ESCALATE: Too complex — human developer should decide

Analyze the conflict and propose the best resolution with reasoning.
Format your response as JSON: { "resolution": "...", "reasoning": "...", "actionForA": "...", "actionForB": "..." }
```

---

## Workspace Memory

Momentum maintains a **shared workspace memory** — a persistent log of decisions, resolutions, and applied patches that any agent can query for context:

```
Tool: momentum_get_session_context
Response: {
  "activeIntents": [...],
  "recentDecisions": [
    {
      "type": "negotiation_resolution",
      "timestamp": "2026-04-11T10:28:00Z",
      "summary": "alice-agent will refactor verifyToken first; bob-agent will adapt rate limiter afterward",
      "filesAffected": ["src/auth/middleware.ts"]
    }
  ],
  "appliedPatches": [...],
  "currentFileOwnership": {
    "src/auth/middleware.ts": "alice-agent (intent_017)",
    "src/api/ratelimit.ts": "bob-agent (intent_019)"
  }
}
```

This prevents agents from re-litigating resolved conflicts and gives late-joining agents immediate context about the session's history.

---

## Integration with Monolith RLM

For teams using Claude Code with the Monolith RLM framework (recursive reasoning over large contexts), Momentum's MCP tools integrate natively:

- Momentum's `momentum_get_session_context` provides the RLM root LLM with the current coordination state
- The intent graph becomes part of the RLM's reasoning context
- RLM's persistent thread memory can store Momentum session summaries for cross-session continuity
- This combination allows Claude Code agents using RLM to reason about coordination history across multiple sessions — not just within the current one

---

## Failure Modes and Fallbacks

| Failure | Fallback |
|---|---|
| Negotiation LLM call times out | Fall back to ESCALATE — human decides |
| Agent doesn't respond to negotiation | Auto-stage as shadow patch after 60s |
| Network disconnect during conflict check | Conservative fallback: block and show warning |
| SQLite corruption | In-memory fallback; session state partially degraded |
| Agent submits conflicting intents for same file | First-registered intent wins; second is queued |
