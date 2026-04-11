# Product Roadmap

## From Hackathon Demo to Real Startup

---

## Phase 0: Hackathon MVP (Current Sprint)

**Timeline:** 24 hours  
**Goal:** Prove the core loop works in a live demo

### Deliverables
- [ ] VS Code extension with presence, intent, and patch panels
- [ ] Coordination backend with WebSocket real-time sync
- [ ] File-level and function-level conflict detection
- [ ] MCP tools for Claude Code integration
- [ ] Agent negotiation via Claude claude-sonnet-4-6
- [ ] Shadow patch staging and approval
- [ ] Live demo with two simultaneous AI agents

**Success criteria:** Demo runs cleanly for 3 minutes. Judges can see the conflict caught and resolved in real time.

---

## Phase 1: Public Beta (Months 1–3)

**Timeline:** 3 months post-hackathon  
**Goal:** Get to 1,000 active users. Find product-market fit signal.

### Engineering
- [ ] Stabilize backend for concurrent sessions (move from SQLite to PostgreSQL)
- [ ] Add GitHub OAuth login (replace token-based auth)
- [ ] Implement GitHub sync: clean commit with intent metadata
- [ ] Expand AST parsing to Python (in addition to TypeScript/JavaScript)
- [ ] Add session history and replay (90-day retention)
- [ ] Improve negotiation quality: structured output, better conflict classification
- [ ] Add Slack integration: conflict alerts, session summaries via DM

### Product
- [ ] Onboarding flow: first session in under 5 minutes
- [ ] Session templates: "Hackathon Mode", "Sprint Mode", "Solo + AI Mode"
- [ ] Public session sharing: share a link to let anyone join read-only
- [ ] VS Code Marketplace listing with rating optimization

### Distribution
- [ ] Post on Hacker News (Show HN)
- [ ] Partner with 3 hackathons as featured tool
- [ ] Beta waitlist + invite-only for first 500 users
- [ ] Weekly changelog and build-in-public Twitter thread

**Success criteria:** 1,000 MAU, 15% D7 retention, 5 paying teams.

---

## Phase 2: Team Adoption (Months 3–9)

**Timeline:** Months 3–9 post-hackathon  
**Goal:** $10K MRR. Establish Momentum as the standard for AI-native team development.

### Engineering
- [ ] Multi-language AST support: Go, Python, Rust, Java
- [ ] Dependency graph conflict detection (catch indirect conflicts)
- [ ] Agent confidence scoring: agent reports uncertainty → triggers review
- [ ] Persistent workspace memory across sessions (long-term intent history)
- [ ] JetBrains plugin (IntelliJ / WebStorm) for Java/Kotlin teams
- [ ] Admin dashboard: per-user activity, conflict analytics, session heatmaps
- [ ] SSO: Google Workspace integration

### Product
- [ ] Team-level conflict policies: define which files always require approval
- [ ] Scheduled sync: automatically push to GitHub at end of day
- [ ] AI-generated PR descriptions from session intent history
- [ ] Neovim/Emacs integration via LSP protocol
- [ ] Mobile companion app (read-only session view for managers)

### Distribution
- [ ] Product Hunt launch (target Product of the Day)
- [ ] YC / Techstars partnership: free Pro for all cohort companies
- [ ] Developer influencer program (5 creators, 50K+ combined audience)
- [ ] Case study: publish "How [Team] shipped X in Y days with Momentum"

**Success criteria:** $10K MRR, 5,000 MAU, 200 paying teams.

---

## Phase 3: Platform and Enterprise (Months 9–18)

**Timeline:** Months 9–18  
**Goal:** $1M ARR. Begin upmarket move to growth-stage and enterprise customers.

### Engineering
- [ ] Enterprise SSO: Okta, Azure AD
- [ ] Audit log: immutable record of all coordination decisions
- [ ] Private deployment: self-hosted backend option (Docker Compose)
- [ ] Advanced conflict resolution: ML-trained on historical negotiation data
- [ ] Agent coordination API: open to third-party integrations
- [ ] Webhook system: notify external systems (CI/CD, monitoring) of coordination events
- [ ] Compliance exports: CSV/PDF session reports for regulated industries

### Product
- [ ] Enterprise admin console: org-level settings, team hierarchy, billing
- [ ] Custom coordination policies: fine-grained rules by team, project, file type
- [ ] Integration marketplace: Jira, Linear, GitHub Projects, Notion sync
- [ ] Momentum for CI/CD: run coordination checks in automated pipelines

### Distribution
- [ ] Hire first SDR (Sales Development Rep)
- [ ] Target: companies with 10–50 engineers using AI coding tools
- [ ] Partner with Anthropic as preferred coordination layer for Claude Code teams
- [ ] Conference presence: GitHub Universe, KubeCon, local dev meetups

**Success criteria:** $1M ARR, 20 enterprise customers, Series A fundraise.

---

## Phase 4: Coordination Infrastructure Layer (Year 2+)

**Long-term vision:** Momentum becomes the coordination middleware layer for AI-native software development — not just for coding, but for any team-based AI workflow.

### Strategic Expansions

**AI Agent Marketplace**
Open an agent store where teams can plug in specialized coordination agents: security review agents, performance analysis agents, documentation agents. Momentum provides the coordination substrate; third parties build on top.

**Cross-Repository Coordination**
Extend beyond single repos: coordinate across microservices, monorepos, and multi-team projects. Become the system of record for organizational-level AI agent activity.

**Async / Time-Zone Mode**
"Handoff Mode" for distributed teams: when Alice ends her session, she leaves structured context for Bob to pick up — intent notes, in-progress patches, decisions made. Momentum becomes the async coordination layer for remote-first teams.

**AI-Native Code Review**
Leverage accumulated intent history to power smarter code review: instead of reviewing a diff, review whether the change matches the declared intent, and whether it avoids known coordination anti-patterns.

---

## Key Milestones Summary

| Milestone | Target Date | KPI |
|---|---|---|
| Hackathon demo | Day 0 | Demo works live |
| 100 beta users | Month 1 | Sign-ups via HN post |
| First paying team | Month 2 | $60 MRR |
| 1K MAU | Month 3 | Organic growth |
| Hackathon partnership (3) | Month 3 | Distribution channel |
| Product Hunt launch | Month 4 | 500 upvotes target |
| $10K MRR | Month 9 | PMF signal |
| JetBrains plugin | Month 9 | Market expansion |
| First enterprise pilot | Month 12 | >$5K ACV |
| $1M ARR | Month 18 | Series A readiness |
| 10 enterprise customers | Month 18 | Upmarket traction |

---

## What Would Make Us Raise a Seed Round

We would be ready to raise a $2–3M seed at these signals:
- $10K MRR with >80% retention at 90 days
- 3+ enterprise pilots with >$1K/month ACV
- Clear differentiation from any GitHub or Microsoft response
- Agent coordination API with 2+ third-party integrations
- Strong HN + Twitter community reputation in the AI dev tools space
