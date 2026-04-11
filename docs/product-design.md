# Product Design

## User Experience, Core Flows, and Interface Design

---

## Design Philosophy

**Invisible until necessary. Indispensable when it matters.**

Lattice should feel like a seatbelt, not a dashboard. Developers shouldn't have to interact with it constantly — it runs in the background and only surfaces when something important needs attention. When a conflict is detected, it should be impossible to miss. When everything is clear, it should be invisible.

Secondary principle: **Context over interruption.** Rather than blocking an edit with a modal, Lattice gives developers context and options. They always have the final say.

---

## Core Surfaces

### 1. Session Panel (VS Code Sidebar)

The primary Lattice UI lives in the VS Code sidebar. It has three tabs:

**Tab 1: Presence**
- List of all active team members with online/away status
- Current task description per person
- Files actively being edited (with file-change indicators)
- AI agent status per person (idle / running / staging)
- "Start Session" / "Join Session" button

**Tab 2: Intent Graph**
- Live visualization of all active intents
- Each intent card shows: owner, task description, file scope, status
- Color coding: green (safe), yellow (potential overlap), red (active conflict)
- Click any intent card to see full task detail and file list

**Tab 3: Patches**
- List of pending shadow patches awaiting review
- Each patch card shows: proposing agent, target file, diff preview, related intent
- Approve / Reject / Modify actions per patch
- Timestamp and expiry indicator

---

### 2. Inline File Indicators

When a file is open in the editor and another team member (or agent) has an active intent touching that file:

- A colored indicator appears in the gutter (left margin) on relevant lines
- A hover tooltip shows: *"@alice's agent is modifying this function as part of: 'Refactor auth to OAuth2'"*
- The file tab in the editor bar shows a small avatar icon indicating active ownership

---

### 3. Conflict Warning Banner

When a developer (or agent) attempts to save changes to a file that is in conflict with an active intent:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚠ Lattice: Potential Conflict Detected                              │
│                                                                       │
│  @bob's agent is modifying verifyToken() for task:                    │
│  "Add rate limiting to auth endpoints"                                │
│                                                                       │
│  Your change affects: verifyToken(), createSession()                  │
│                                                                       │
│  [View Bob's Intent]  [Stage as Shadow Patch]  [Override & Save]     │
└──────────────────────────────────────────────────────────────────────┘
```

This banner is non-blocking — the developer can always choose to override. But the context is surfaced prominently and the default action is "stage as shadow patch."

---

### 4. Agent Negotiation Log

A real-time feed showing agent-to-agent communications during active sessions:

```
[10:24:01] agent-alice → agent-bob
  Intent: "Refactor auth middleware for OAuth2"
  Conflict: verifyToken() signature change
  Proposal: "I'll change the signature first; can you adapt your rate
             limiter to the new signature once I'm done?"

[10:24:03] agent-bob → agent-alice
  Response: "Agreed. I'll pause on verifyToken() and work on the
             middleware wrapper instead. Notifying Bob."

[10:24:04] system → bob
  "Your agent has deferred work on verifyToken(). Reason: Alice's
   agent is mid-refactor. Estimated completion: 8 minutes."
```

---

### 5. Session Summary (on sync to GitHub)

When a developer syncs to GitHub at the end of a session, Lattice generates a structured commit message:

```
feat(auth): OAuth2 support + rate limiting [Lattice Session #117]

Coordinated changes across 3 developers and 4 AI agents:
- alice: Refactored verifyToken() and createSession() for OAuth2 scope support
- bob: Added rate limiting middleware (adapted to new verifyToken signature)
- carol: Updated test suite for new auth interfaces

Conflicts detected: 2
Conflicts auto-resolved: 1 (agent negotiation)
Human approvals: 1 (verifyToken signature change)
Shadow patches applied: 3

Session duration: 2h 14m | Lattice build-mode session
```

---

## Core User Flows

### Flow 1: Joining a Session

```
1. Developer opens VS Code
2. Clicks Lattice icon in sidebar
3. Sees "No active session" state
4. Enters session code (shared by team lead) or creates new session
5. Presence panel populates with team members
6. Developer submits their current task intent via the text field
7. System parses intent and creates Intent Node
8. Developer starts coding — Lattice monitors in background
```

### Flow 2: Agent Conflict Caught

```
1. Developer's AI agent requests a file write to auth/middleware.ts
2. Lattice intercepts the write request (via MCP tool hook)
3. Conflict engine finds active intent from bob's agent on same file/function
4. Returns CONFLICT verdict
5. Agents negotiate automatically
6. Resolution: agent-alice proceeds; agent-bob is notified to wait
7. Bob sees notification in Lattice panel: "Your agent deferred: reason X"
8. alice's change is applied; intent node updated
9. Bob's agent resumes with updated context
```

### Flow 3: Shadow Patch Review

```
1. Agent proposes change to shared interface (high-confidence conflict risk)
2. Lattice stages the change as shadow patch instead of applying
3. All relevant team members see a patch notification in sidebar
4. Developer clicks "View Patch" → sees diff preview in editor
5. Developer clicks "Approve" → patch is applied to working tree
6. Intent node marked complete; agent notified
```

### Flow 4: GitHub Sync

```
1. Team signals "session complete" in Lattice panel
2. Lattice shows session summary: changes, conflicts resolved, patches applied
3. Developer reviews and edits the proposed commit message
4. Clicks "Sync to GitHub"
5. Lattice creates a clean commit with intent metadata
6. Session is archived; history available for 90 days
```

---

## Design Constraints for Hackathon MVP

For the hackathon, we will prioritize:

1. **Presence panel** — real-time view of who is online and what they're working on
2. **Intent registration** — simple text input that creates an intent node
3. **Conflict warning banner** — inline notification when a conflict is detected
4. **Shadow patch staging** — ability to propose a change before applying
5. **Agent negotiation log** — visible log of agent communications

We will defer:
- Full intent graph visualization (use a simplified list)
- GitHub sync (manual git commit with intent metadata is acceptable for demo)
- Mobile / web UI (VS Code extension only for MVP)
