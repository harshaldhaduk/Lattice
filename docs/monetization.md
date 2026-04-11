# Monetization Strategy

## How Lattice Builds a Sustainable, Scalable Revenue Model

---

## Core Principle

**Free for small teams. Paid for teams that grow and depend on it.**

Lattice follows a product-led growth (PLG) model where free tiers drive adoption and viral growth, while paid tiers capture value from teams that have made Lattice part of their critical workflow.

The hosted backend — session management, agent communication bus, intent graph persistence, and GitHub sync — is the monetizable layer. The VS Code extension is open-source and free.

---

## Pricing Tiers

### Tier 1: Free (Hackathon / Student)
**$0/month — up to 3 users, 2 concurrent sessions**

- Full coordination features (intent tracking, conflict detection, shadow patching)
- Up to 3 team members per session
- Session history: 7 days
- Community support
- Lattice branding on session exports

**Goal:** Maximum adoption. This tier should be genuinely useful. Students, hackathon teams, and individuals should never need to upgrade unless they grow.

---

### Tier 2: Team Pro
**$20/seat/month — up to 15 users**

- Unlimited concurrent sessions
- Up to 15 team members
- Session history: 90 days
- Priority agent negotiation (faster LLM calls)
- GitHub integration (clean sync with intent metadata in commit messages)
- Slack / Linear integration for task sync
- Email support + Slack community

**Target:** Startup founding teams, small product teams, freelance squads

---

### Tier 3: Scale
**$40/seat/month — 15–100 users**

- Everything in Team Pro
- Admin dashboard: per-user activity, conflict analytics, agent usage
- SSO (Google Workspace, Okta)
- Advanced conflict analytics (heatmaps by file/module)
- Audit log (who approved what, when, why)
- Priority support (response within 4 hours)
- API access for custom integrations

**Target:** Growth-stage startups, scale-ups, remote engineering teams

---

### Tier 4: Enterprise
**$80–120/seat/month — 100+ users (negotiated annually)**

- Everything in Scale
- Private deployment option (self-hosted backend)
- Custom agent negotiation rules and policies
- Enterprise SLA (99.9% uptime guarantee)
- Dedicated customer success manager
- Custom integrations (internal tools, proprietary CI/CD)
- Security review and compliance documentation (SOC 2 Type II roadmap)

**Target:** Mid-market and enterprise engineering teams with 50+ AI-assisted developers

---

## Revenue Projections

| Stage | Active Seats | ARPU | MRR | ARR |
|---|---|---|---|---|
| Hackathon launch (Month 1) | 500 (free) | $0 | $0 | $0 |
| Early traction (Month 6) | 2,000 (200 paid) | $20 | $4K | $48K |
| PMF signal (Month 12) | 10,000 (1K paid) | $22 | $22K | $264K |
| Growth (Month 18) | 40,000 (5K paid) | $25 | $125K | $1.5M |
| Scale (Month 24) | 100,000 (15K paid) | $30 | $450K | $5.4M |

---

## Unit Economics (Target)

- **CAC (PLG):** $15–30 per paying seat (low-touch, self-serve)
- **CAC (Sales-assisted):** $200–500 per seat for enterprise
- **LTV:** $400–800 for self-serve teams; $2,000–8,000 for enterprise
- **LTV:CAC ratio target:** >10x (self-serve), >8x (enterprise)
- **Payback period target:** <6 months

---

## Additional Revenue Streams (Year 2+)

### API Access
Charge per agent-coordination API call for teams building custom agents on Lattice's infrastructure. Pricing: $0.002–$0.01 per coordination event.

### Marketplace (Year 3)
Allow third-party developers to build Lattice plugins (integration with Jira, custom conflict resolution logic, specialized agent protocols). Take 20% platform fee.

### Data Insights (Opt-in, Anonymized)
Enterprise customers pay for aggregate team productivity insights derived from intent graph data — e.g., "your team spends 18% of coordination time on auth-related conflicts." Privacy-preserving; opt-in only.

---

## Competitive Pricing Rationale

| Competitor | Price | What it does |
|---|---|---|
| GitHub Teams | $4/seat/mo | Version control |
| Cursor Pro | $20/seat/mo | AI code editing |
| Linear | $8/seat/mo | Task management |
| VS Code Live Share | Free | Pair programming |
| **Lattice Team Pro** | **$20/seat/mo** | **AI coordination layer** |

At $20/seat, Lattice is priced at parity with Cursor — the AI coding tool it complements. The value proposition is clear: if you're already paying $20/seat for an AI that writes code, you should pay another $20/seat to make sure that code doesn't collide with your teammates'.
