# Customer Personas

## Who Feels This Pain Most — and Who We Build For First

---

## ICP Summary

Lattice's ideal customer is a **small, fast-moving team building software with AI agents, under time pressure, where coordination friction directly reduces output quality.**

---

## Primary Personas

---

### Persona 1: The Hackathon Lead
**"We've got 20 hours left and three of us are all touching the auth layer."**

- **Who:** CS student or early career developer, 20–26, leading a hackathon team of 3–4
- **Tools:** VS Code, Claude Code or Cursor, GitHub
- **Pain:** Everyone is building in parallel, AI agents are writing code fast, and the team keeps stomping on each other's changes. Merge conflicts show up at 3am and kill the team's flow.
- **Goal:** Ship a working demo in 24 hours without wasting time on coordination
- **Trigger to adopt:** Hears about Lattice from another team or finds it featured in a hackathon toolkit
- **Success metric:** Zero merge conflicts during the sprint; clean demo at submission

---

### Persona 2: The Startup CTO / Technical Co-founder
**"We're 3 engineers moving fast. I don't want to spend 30% of our time on PR reviews and merge conflicts."**

- **Who:** Technical co-founder or lead engineer at a 2–8 person startup, 26–35
- **Tools:** VS Code / Cursor, Claude Code, GitHub, Linear
- **Pain:** The team is moving fast with AI help, but coordination is ad-hoc. Slack messages like "don't touch auth today" are the current solution. It's not scaling.
- **Goal:** Maintain development velocity as the team grows and AI agents become more autonomous
- **Trigger to adopt:** Hits a painful merge incident that costs a day of recovery; discovers Lattice in a dev tools newsletter or on HN
- **Success metric:** Reduction in time-to-deploy and inter-developer friction; improved confidence in parallel AI workstreams

---

### Persona 3: The AI-First Engineer
**"I run 3 Claude Code sessions in parallel. I basically need a coordinator for my agents."**

- **Who:** Senior or staff engineer at an AI-native company or solo founder, 28–40
- **Tools:** Claude Code, multiple AI agent sessions, VS Code, custom scripts
- **Pain:** Already uses AI agents heavily but manages coordination manually through comments, file naming conventions, and context switching. Deeply frustrated by the lack of tooling.
- **Goal:** Run multiple AI agents simultaneously without babysitting each one for conflicts
- **Trigger to adopt:** Actively searching for this solution; highly likely to find Lattice via Twitter/X or Hacker News
- **Success metric:** Ability to run 3–4 agents in parallel with <5% collision rate; reduced manual oversight time

---

### Persona 4: The CS Professor / Teaching Assistant
**"20 students are all pushing to the same repo for a group project. It's chaos."**

- **Who:** CS faculty or TA at a university, 25–50
- **Tools:** GitHub Classroom, VS Code, various AI tools
- **Pain:** Group projects devolve into "who has the latest version" chaos. Students don't know how to use Git properly and AI assistance makes the problem worse (AI agents commit directly to main).
- **Goal:** Give students a real-world parallel development experience with guardrails
- **Trigger to adopt:** Hears about Lattice via a teaching tools newsletter or a colleague; tries it for a project course
- **Success metric:** Fewer broken builds in student repos; students learn coordination concepts naturally

---

## Secondary Personas (Near-Term Expansion)

### Persona 5: The Remote Engineering Team Lead
**"We're 8 engineers across 3 time zones. I need async handoff to work better."**
- Cares about async-friendly coordination, time-zone-aware handoff, and intent preservation across sessions

### Persona 6: The Enterprise AI Platform Team
**"We're building internal tools with AI agents. We need coordination primitives."**
- Cares about security, auditability, enterprise SSO, and integration with internal systems

---

## Customer Journey Map

```
AWARENESS
Developer hears about Lattice via:
- Hackathon toolkit / sponsor page
- Twitter/X or Hacker News post
- Colleague recommendation
- Dev tools newsletter

ACTIVATION
- Installs VS Code extension (< 2 min)
- Creates a session, invites teammates
- Sees intent panel populate in real time
- First conflict caught automatically → "oh wow, that actually works"

RETENTION
- Uses Lattice in every team coding session
- Adds it to their project's onboarding README
- Notices reduction in merge conflicts and duplicate work

EXPANSION
- Team grows → adds seats
- Uses Lattice for more projects
- Requests integrations (JetBrains, Neovim, etc.)

REFERRAL
- Recommends to other teams at hackathons or in Slack communities
- Posts about it on Twitter/X
- Writes a blog post: "How we ship with 4 AI agents and zero merge hell"
```

---

## Willingness to Pay

| Segment | WTP per seat/month | Decision maker | Sales motion |
|---|---|---|---|
| Hackathon teams | Free / freemium | Team lead | Self-serve |
| Student teams | Free / $5 | Student + TA | Self-serve / edu license |
| Startup (2–10) | $20–40 | CTO / founder | Self-serve / PLG |
| Scale-up (10–50) | $30–60 | Eng manager | Sales-assisted |
| Enterprise | $80–120 | VP Engineering | Enterprise sales |
