# Demo Script

## How to Present Momentum to Judges and Investors

---

## 30-Second Demo Pitch

> "Today, three developers working in parallel with AI agents are basically flying blind — each agent writes code without knowing what the others are doing. The result is merge conflicts, duplicated work, and broken assumptions discovered way too late.
>
> Momentum is a coordination layer inside your IDE. Every agent declares its intent before writing. Every conflict is caught before it's applied. Agents negotiate with each other automatically. Humans approve what matters.
>
> We just turned parallel AI coding from chaos into a coordinated system — and it works inside VS Code today."

---

## 2-Minute Demo Narrative

> "Let me show you a scenario that every developer on an AI-native team runs into constantly.
>
> We've got two developers here — Alice and Bob — both building out an auth system in the same codebase. They're each using Claude Code as their AI agent.
>
> [SHOW: Momentum sidebar open in VS Code for both Alice and Bob]
>
> They've both joined the same Momentum session. You can see their presence in real time — Alice is online, Bob is online. No one has registered a task yet.
>
> Alice starts first. She types her task: 'Refactor verifyToken to support OAuth2 scopes.'
>
> [SHOW: Alice types intent, intent card appears in the session]
>
> Momentum parses that task and creates an intent node — Alice owns `verifyToken`, `createSession`, and `auth/middleware.ts`. Everyone in the session can see this.
>
> Now Bob starts his task at the same time. His task: 'Add rate limiting to the auth endpoints.'
>
> [SHOW: Bob types intent, Bob's intent card appears]
>
> Bob's agent starts working — it reads `verifyToken`, figures out where to inject the rate limit check, and is about to write its change.
>
> [SHOW: Agent writes to verifyToken — conflict banner appears]
>
> Stop. Look at that. Before the edit is applied, Momentum catches it. Bob's agent wanted to edit `verifyToken` — but Alice's agent has already claimed it. The banner says: 'Alice's agent is modifying this function. Here's why.'
>
> Bob's agent doesn't just get blocked — it negotiates. Watch the negotiation log.
>
> [SHOW: Negotiation log — agent-alice and agent-bob exchange messages, orchestrator proposes: 'Agent B defers verifyToken work, continues on middleware wrapper instead']
>
> In 3 seconds, the agents have agreed. Bob's agent continues on the parts of the task that don't conflict. Alice's change goes through cleanly.
>
> [SHOW: Alice's change applied; Bob's agent continues on different files]
>
> Bob gets a notification: 'Your agent deferred verifyToken. It'll resume once Alice is done.'
>
> [SHOW: Alice completes her task, marks intent complete; Bob's intent unblocks]
>
> Alice's work is done. Her intent is marked complete. Bob's agent is automatically notified and resumes — now with full context about the new `verifyToken` signature. No merge conflict. No duplicated work. No developer had to type a single message.
>
> That's Momentum. Intent-aware. Agent-coordinated. Built for the way teams actually build today."

---

## Live Demo Flow (Step by Step)

### Setup (Before Demo)

**Terminal 1:** Start Momentum backend
```bash
cd server && npm run dev
# Server running on ws://localhost:3001
```

**Terminal 2:** Open demo repo in VS Code (Window 1 = Alice, Window 2 = Bob)
```bash
code demo-repo
# Momentum extension auto-activates
```

**Pre-loaded:** Demo repo has `src/auth/middleware.ts` with `verifyToken()` and `createSession()`

---

### Demo Sequence

**[0:00 – 0:20] Setup the context**
- Show the demo repo with `auth/middleware.ts` open
- Show two VS Code windows side by side
- Briefly explain: "Alice and Bob are both building auth features"

**[0:20 – 0:45] Join session + presence**
- Alice creates a Momentum session → gets a code
- Bob enters the session code → both appear in each other's Presence panel
- *"In real time, I can see who's in my session and what they're working on"*

**[0:45 – 1:15] Register intents**
- Alice types: "Refactor verifyToken for OAuth2 scope support"
- Bob types: "Add rate limiting to auth endpoints"
- Both intent cards appear in the Intent tab
- *"Both agents have declared their intent. The system now knows what each person is trying to do."*

**[1:15 – 1:45] Conflict detection**
- Both agents begin working (pre-scripted prompts sent to Claude Code)
- Bob's agent attempts to write to `verifyToken`
- Conflict banner appears in Bob's window
- *"Before the edit lands, Momentum catches it. Alice already owns this function."*

**[1:45 – 2:10] Negotiation**
- Negotiation log populates with agent messages
- Resolution appears: Bob's agent defers, continues on different files
- Alice's agent proceeds and applies its change
- *"The agents negotiated automatically. No Slack message needed. No one was blocked."*

**[2:10 – 2:30] Patch staging (bonus)**
- Show a second scenario: agent proposes a change to a shared type file
- Change staged as shadow patch → Alice sees it in the Patches tab
- Alice approves → patch applied
- *"For high-stakes changes, humans stay in the loop. One click to approve."*

**[2:30 – 2:45] Wrap**
- Show both agents complete their work
- Show the clean session summary
- *"No merge conflicts. No duplicated work. That's Momentum."*

---

## Q&A Prep

**Q: How is this different from VS Code Live Share?**
> Live Share is for pair programming — one driver, everyone sees the same screen. Momentum is for independent parallel work — three people doing different things, with agents, and Momentum making sure they don't step on each other.

**Q: Why not just use Git branches?**
> Branches work great for durable history. But during a 24-hour sprint with AI agents running, creating a branch for every micro-task is overhead you don't want. Momentum is the pre-Git layer — it coordinates during the build phase, then syncs cleanly to Git when you're ready.

**Q: What if the AI agent doesn't use MCP?**
> We also intercept at the VS Code file save level — so even agents that don't use MCP are caught when they try to write to disk. MCP gives us the richer intent context; file save gives us the safety net.

**Q: How do you handle more than 2 agents?**
> The conflict detection and negotiation scale to N agents. Each agent has an intent node; every pre-write check compares against all active intents. Negotiation messages include all conflicting parties. The orchestrator resolves N-way conflicts by proposing an ordering.

**Q: What does monetization look like?**
> Free for teams up to 3. $20/seat/month for growing teams. The hosted coordination backend and agent communication bus are the paid layer. Long-term: API access for enterprises building their own AI agents on our infrastructure.

---

## Slide Structure (For Judges)

1. **Headline slide:** "The AI-native coding team has a coordination problem."
2. **Problem:** Show the chaos scenario — 3 agents, 1 codebase, no awareness
3. **Solution:** "Momentum: intent-aware coordination for AI-native teams"
4. **Demo:** Live (or recorded fallback)
5. **How it works:** Simple 3-step diagram (Register → Check → Resolve)
6. **Technical architecture:** High-level diagram (Extension → Backend → LLM)
7. **Market:** $32B developer tools, AI-native teams growing rapidly
8. **Business model:** Free + $20/seat SaaS
9. **Traction / vision:** Where we go from here
10. **Ask / close:** "The problem is real. The timing is right. We built it."
