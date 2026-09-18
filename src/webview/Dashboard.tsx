import React, { useState } from "react";
import {
  Plus,
  Search,
  GitBranch,
  ArrowUpRight,
  Users,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import type { AppState, SessionCard } from "../shared/protocol";
const labels: Record<string, string> = {
  active: "In progress",
  reconciling: "Updating",
  attention: "Needs you",
  review: "In review",
  merged: "Merged",
  closed: "Closed without merge",
};
export function Dashboard({
  state,
  post,
}: {
  state: AppState;
  post: (m: any) => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("active");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [joining, setJoining] = useState(false);
  const [link, setLink] = useState("");
  const s = state.session;
  const cards: SessionCard[] = state.dashboard?.length
    ? state.dashboard
    : s
      ? [
          {
            ...s,
            pending: s.approvals.filter((a) => a.status === "pending").length,
            completed: s.plan.filter((p) => p.done).length,
            steps: s.plan.length,
          },
        ]
      : [];
  const visible = cards.filter(
    (s) =>
      (tab === "completed" ? s.archived : !s.archived) &&
      `${s.title} ${s.branch}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main className="dashboard">
      <header className="dashboard-heading">
        <div>
          <p className="eyebrow">LATTICE</p>
          <h1>Your sessions</h1>
          <p>One feature. One branch. Work together.</p>
        </div>
        <div className="row">
          <button className="secondary" onClick={() => setJoining(!joining)}>
            Join session
          </button>
          <button className="primary" onClick={() => setCreating(!creating)}>
            <Plus size={15} /> New session
          </button>
        </div>
      </header>
      {state.error && (
        <div role="alert" className="dashboard-notice">
          {state.error}
          <button
            className="text-button"
            onClick={() => post({ type: "clearError" })}
          >
            Dismiss
          </button>
        </div>
      )}
      {creating && (
        <form
          className="dashboard-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) {
              post({ type: "host", title: title.trim() });
              setCreating(false);
            }
          }}
        >
          <label>
            What are you building?
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Add multiplayer lobby"
            />
          </label>
          <p>
            Lattice prepares a new branch from the base branch. Invite your
            teammate once it opens.
          </p>
          <button className="primary" type="submit">
            Start session <ArrowRight size={14} />
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setCreating(false)}
          >
            Cancel
          </button>
        </form>
      )}
      {joining && (
        <form
          className="dashboard-create"
          onSubmit={(e) => {
            e.preventDefault();
            post({ type: "join", link });
            setJoining(false);
          }}
        >
          <label>
            Invitation link
            <input
              autoFocus
              required
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste your invitation"
            />
          </label>
          <button className="primary">Join live work</button>
        </form>
      )}
      <div className="dashboard-filters">
        <div role="group" aria-label="Session status">
          <button
            className={tab === "active" ? "active" : ""}
            onClick={() => setTab("active")}
          >
            Active
          </button>
          <button
            className={tab === "completed" ? "active" : ""}
            onClick={() => setTab("completed")}
          >
            Completed
          </button>
        </div>
        <label className="dashboard-search">
          <Search size={14} />
          <input
            aria-label="Search sessions"
            placeholder="Find a session…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className="icon-button"
          aria-label="Refresh sessions"
          onClick={() => post({ type: "refreshDashboard" })}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {!visible.length && (
        <div className="dashboard-empty">
          <GitBranch size={28} />
          <h2>
            {query
              ? "No matching sessions"
              : tab === "completed"
                ? "Finished work will appear here"
                : "Start something together"}
          </h2>
          <p>
            {tab === "completed"
              ? "Merged pull requests close their sessions automatically."
              : "Create a session, invite a teammate, and describe the work."}
          </p>
        </div>
      )}
      <div className="session-grid">
        {visible.map((s) => (
          <article className="session-tile" key={s.id}>
            <button
              className="session-tile-open"
              aria-label={`Open session ${s.title}`}
              onClick={() => post({ type: "openSession", id: s.id })}
            >
              <div className="row">
                <span
                  className={`session-status ${s.lifecycle?.status || "active"}`}
                >
                  {labels[s.lifecycle?.status || "active"]}
                </span>
                {s.pending > 0 && (
                  <span className="decision-count">{s.pending} waiting</span>
                )}
              </div>
              <h2>{s.title}</h2>
              <p className="session-branch">
                <GitBranch size={12} />
                {s.branch}
              </p>
              {s.steps > 0 && (
                <p>
                  {s.completed} of {s.steps} steps complete
                </p>
              )}
              <div className="session-team">
                <Users size={13} />
                {s.people.map((p) => p.name).join(", ") || "Just you"}
              </div>
            </button>
            {s.lifecycle?.pullRequest && (
              <button
                className="session-pr"
                onClick={() => post({ type: "openPR", id: s.id })}
              >
                PR #{s.lifecycle.pullRequest.number}
                <ArrowUpRight size={13} />
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="dashboard-footnote">
        {state.connected
          ? "Live session updates connected"
          : "Showing saved sessions · open one to reconnect"}
      </p>
    </main>
  );
}
