# Technical Architecture

## System Design for Momentum's Coordination Layer

---

## Architecture Philosophy

**Buildable in a hackathon. Scalable to a startup.**

We use proven, boring technology in the right places and apply LLM intelligence only where rules-based logic would fail. No CRDTs unless justified. No distributed consensus where a single-writer lock works fine. No microservices where a monolith will do.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DEVELOPER WORKSTATION                        │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  VS Code + Momentum Extension                 │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │  Presence   │  │ Intent Panel │  │  Patch Staging   │   │  │
│  │  │   Panel     │  │              │  │     Panel        │   │  │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘   │  │
│  │                                                              │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │             File Save Interceptor                     │   │  │
│  │  │          (VS Code workspace.onDidSaveTextDocument)    │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  │                                                              │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │                  MCP Tool Server                      │   │  │
│  │  │   (exposes coordination tools to AI agents)           │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │  WebSocket                           │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│                    MOMENTUM COORDINATION SERVER                     │
│                              │                                      │
│  ┌────────────────┐  ┌───────┴──────────┐  ┌──────────────────┐   │
│  │ Session Manager│  │  WebSocket Hub   │  │  Intent Graph DB │   │
│  │                │  │  (Socket.io)     │  │  (SQLite)        │   │
│  └────────────────┘  └──────────────────┘  └──────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Conflict Detection Engine                    │  │
│  │                                                              │  │
│  │  ┌──────────────────┐  ┌─────────────────────────────────┐  │  │
│  │  │  File-level Check│  │  Function-level Check (AST diff) │  │  │
│  │  └──────────────────┘  └─────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                Agent Negotiation Orchestrator                 │  │
│  │                   (Claude claude-sonnet-4-6 API)                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Patch Staging Service                        │  │
│  │              (git apply --cached under the hood)             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    GitHub Sync Service                        │  │
│  │                    (simple-git + Octokit)                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. VS Code Extension (TypeScript)

**Responsibilities:**
- Display Presence, Intent, and Patch panels in the sidebar
- Intercept file save events and route them through the conflict check
- Render inline file indicators when a file is under active intent
- Show conflict warning banners before writes are applied
- Communicate with the MCP Tool Server (for AI agent integration)
- Send/receive real-time events via WebSocket to the coordination server

**Key VS Code APIs used:**
- `vscode.window.createWebviewPanel` — sidebar UI
- `vscode.workspace.onDidSaveTextDocument` — file save interception
- `vscode.languages.registerHoverProvider` — inline intent tooltips
- `vscode.window.showInformationMessage` — conflict notification banners
- `vscode.workspace.onDidChangeTextDocument` — live edit tracking

**Key dependencies:**
- `socket.io-client` — WebSocket connection to backend
- `@modelcontextprotocol/sdk` — MCP tool server for AI agent coordination

---

### 2. Coordination Backend (Node.js + Express + Socket.io)

**Responsibilities:**
- Manage session lifecycle (create, join, leave, end)
- Maintain real-time presence state for all connected clients
- Accept and store intent declarations
- Run the conflict detection engine on incoming edit requests
- Route agent-to-agent messages via the negotiation orchestrator
- Store session data in SQLite
- Manage shadow patches (create, list, approve, reject)

**API Routes:**
```
POST   /sessions                  → Create session
POST   /sessions/:id/join         → Join session  
GET    /sessions/:id/state        → Get full session state

POST   /intents                   → Register intent
PATCH  /intents/:id               → Update intent status
GET    /sessions/:id/intents      → List active intents

POST   /edits/check               → Pre-write conflict check
POST   /patches                   → Create shadow patch
POST   /patches/:id/approve       → Approve shadow patch
POST   /patches/:id/reject        → Reject shadow patch

POST   /sync/github               → Trigger GitHub sync
GET    /sessions/:id/summary      → Get session summary
```

**WebSocket Events:**
```
client → server:
  presence:update    → developer changed their active task
  intent:register    → new intent being submitted
  intent:update      → intent status changed
  edit:precheck      → check an edit before applying
  patch:propose      → propose a shadow patch

server → client:
  presence:changed   → broadcast presence update to room
  intent:added       → new intent in the session
  conflict:detected  → conflict found for a specific file/function
  patch:pending      → new patch needs review
  negotiation:update → agent negotiation status update
  sync:complete      → GitHub sync finished
```

---

### 3. Intent Graph (SQLite via Prisma)

**Schema:**

```sql
-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active' -- active | archived
);

-- Participants
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  name TEXT NOT NULL,
  agent_type TEXT, -- claude-code | cursor | codex | human
  status TEXT DEFAULT 'online', -- online | away | offline
  current_task TEXT,
  last_seen DATETIME
);

-- Intents
CREATE TABLE intents (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  participant_id TEXT REFERENCES participants(id),
  description TEXT NOT NULL,
  file_scope TEXT, -- JSON array of file paths
  function_scope TEXT, -- JSON array of function names
  status TEXT DEFAULT 'in_progress', -- in_progress | complete | deferred | cancelled
  priority TEXT DEFAULT 'normal', -- blocking | normal | background
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

-- Shadow Patches
CREATE TABLE patches (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  intent_id TEXT REFERENCES intents(id),
  proposer_id TEXT REFERENCES participants(id),
  file_path TEXT NOT NULL,
  diff TEXT NOT NULL, -- unified diff format
  status TEXT DEFAULT 'pending', -- pending | approved | rejected | expired
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  reviewed_by TEXT,
  reviewed_at DATETIME
);

-- Negotiation Log
CREATE TABLE negotiations (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  from_participant TEXT REFERENCES participants(id),
  to_participant TEXT REFERENCES participants(id),
  message TEXT NOT NULL,
  message_type TEXT, -- proposal | response | escalation | resolution
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### 4. Conflict Detection Engine

**Two-tier detection:**

**Tier 1: File-level (fast, synchronous)**
- Check if any active intent has the target file in its `file_scope`
- O(1) lookup using an in-memory set of active file claims
- Returns immediately for non-overlapping files

**Tier 2: Function-level (slower, AST-based)**
- Parse the incoming diff to extract modified function names
- Compare against active intents' `function_scope`
- Uses `@babel/parser` (JS/TS) or `tree-sitter` for reliable AST parsing
- Returns `SAFE`, `REVIEW`, or `CONFLICT` verdict with specific conflicting entities

**Verdict logic:**
```typescript
function computeVerdict(
  incomingEdit: EditRequest,
  activeIntents: Intent[]
): ConflictVerdict {
  const fileConflicts = activeIntents.filter(
    i => i.fileScope.includes(incomingEdit.filePath) && 
         i.participantId !== incomingEdit.participantId
  );
  
  if (fileConflicts.length === 0) return { verdict: 'SAFE' };
  
  const functionConflicts = fileConflicts.filter(
    i => i.functionScope.some(fn => incomingEdit.modifiedFunctions.includes(fn))
  );
  
  if (functionConflicts.length === 0) return { verdict: 'REVIEW', conflicts: fileConflicts };
  return { verdict: 'CONFLICT', conflicts: functionConflicts };
}
```

---

### 5. Agent Negotiation Orchestrator (Claude API)

When a `CONFLICT` verdict is returned, the orchestrator is invoked:

```typescript
async function negotiateConflict(
  conflict: ConflictVerdictWithDetails,
  agentA: AgentContext,
  agentB: AgentContext
): Promise<NegotiationResolution> {
  
  const prompt = buildNegotiationPrompt(conflict, agentA, agentB);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });
  
  // Parse structured resolution from response
  return parseNegotiationResolution(response.content[0].text);
}
```

The orchestrator produces one of:
- `SEQUENCE`: Agent B should wait for Agent A to complete
- `PARALLEL`: Edits can be applied in any order (non-overlapping despite same file)
- `MERGE`: Provide a combined patch that satisfies both intents
- `ESCALATE`: Human decision required — too complex to auto-resolve

---

### 6. MCP Tool Server

Exposes Momentum's coordination primitives as MCP tools, allowing any MCP-compatible AI agent (Claude Code, etc.) to integrate natively:

```typescript
// MCP tools exposed by Momentum
const tools = [
  {
    name: 'momentum_register_intent',
    description: 'Register a coding intent before starting work',
    inputSchema: { task: string, files: string[], priority?: string }
  },
  {
    name: 'momentum_check_edit',  
    description: 'Check if a proposed file edit is safe to apply',
    inputSchema: { filePath: string, diff: string, intentId: string }
  },
  {
    name: 'momentum_propose_patch',
    description: 'Stage a change as a shadow patch for human review',
    inputSchema: { filePath: string, diff: string, reason: string }
  },
  {
    name: 'momentum_get_session_context',
    description: 'Get current session state: who is working on what',
    inputSchema: { sessionId: string }
  }
];
```

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| VS Code Extension | TypeScript + VS Code API | Native integration, large ecosystem |
| Extension UI | React (Webview) | Component model for panels |
| Backend server | Node.js + Express | Fast to build, TypeScript compatible |
| Real-time events | Socket.io | Proven, simple, room-based pub/sub |
| Database | SQLite via Prisma | Zero-config, works on any machine |
| AST parsing | @babel/parser + tree-sitter | Language-aware conflict detection |
| LLM (negotiation) | Anthropic Claude claude-sonnet-4-6 | Best reasoning for code context |
| MCP integration | @modelcontextprotocol/sdk | Native Claude Code integration |
| Git operations | simple-git | Lightweight Git wrapper |
| GitHub API | Octokit | Official GitHub REST client |

---

## Hackathon vs. Production Differences

| Concern | Hackathon | Production |
|---|---|---|
| Database | SQLite (local / hosted) | PostgreSQL (managed) |
| Real-time | Socket.io single server | Socket.io + Redis adapter for scale |
| Auth | Simple session tokens | OAuth2 (GitHub login) |
| Deployment | Railway / Fly.io / Render | AWS / GCP with autoscaling |
| AST parsing | JS/TS only | Multi-language (Python, Go, Rust, etc.) |
| Conflict detection | File + function level | Semantic / dependency graph level |

---

## Security Considerations

- Session tokens are short-lived (8-hour TTL by default)
- File diffs are never stored permanently (only in active patches)
- LLM calls for negotiation do not include full file contents — only function signatures and intent summaries
- GitHub OAuth token is stored in VS Code's SecretStorage API (encrypted)
- WebSocket connections are authenticated per session
