import React, { useEffect, useState } from "react";
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
import { isCompletedSession } from "../shared/session-status";
import { StrictnessSlider } from "./StrictnessSlider";
import { Notice } from "./Notice";
import { FocusFrame } from "./FocusFrame";
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
  const [sensitivity, setSensitivity] = useState(
    state.conflictSensitivity || 6,
  );
  useEffect(() => {
    if (state.conflictSensitivity) setSensitivity(state.conflictSensitivity);
  }, [state.conflictSensitivity]);
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
      (tab === "completed" ? isCompletedSession(s) : !isCompletedSession(s)) &&
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
        <div className="dashboard-actions">
          <button className="secondary" onClick={() => setJoining(!joining)}>
            Join session
          </button>
          <button className="primary" onClick={() => setCreating(!creating)}>
            <Plus size={15} /> New session
          </button>
        </div>
      </header>
      <Notice message={state.error} className="dashboard-notice" dismiss={() => post({ type: "clearError" })} />
      {creating && (
        <form
          className="dashboard-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) {
              post({
                type: "host",
                title: title.trim(),
                sensitivity: Math.round(sensitivity),
              });
              setCreating(false);
            }
          }}
        >
          <label>
            What are you building?
            <FocusFrame><input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Add multiplayer lobby"
            /></FocusFrame>
          </label>
          <p>
            Resume unfinished work if you already have a session, or create a
            separate feature branch. Invite your teammate once it opens.
          </p>
          <StrictnessSlider value={sensitivity} change={setSensitivity} />
          <div className="dashboard-actions">
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
          </div>
        </form>
      )}
      {joining && (
        <form
          className="dashboard-create dashboard-join"
          onSubmit={(e) => {
            e.preventDefault();
            post({ type: "join", link, sensitivity: Math.round(sensitivity) });
            setJoining(false);
          }}
        >
          <label>
            Invitation link
            <FocusFrame><input
              autoFocus
              required
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste your invitation"
            /></FocusFrame>
          </label>
          <button className="primary">Join live work</button>
        </form>
      )}
      <div className="dashboard-filters">
        <div role="group" aria-label="Session status" className={`dashboard-status-tabs ${tab === "completed" ? "is-completed" : ""}`}>
          <button
            className={tab === "active" ? "active" : ""}
            aria-pressed={tab === "active"}
            onClick={() => setTab("active")}
          >
            Active
          </button>
          <button
            className={tab === "completed" ? "active" : ""}
            aria-pressed={tab === "completed"}
            onClick={() => setTab("completed")}
          >
            Completed
          </button>
        </div>
        <label className="dashboard-search">
          <Search size={14} />
          <FocusFrame><input
            aria-label="Search sessions"
            placeholder="Find a session…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          /></FocusFrame>
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
              ? "Review-ready branches and their pull requests appear here. Merged sessions are archived automatically."
              : "Create a session, invite a teammate, and describe the work."}
          </p>
        </div>
      )}
      <div className="session-grid">
        {visible.map((s) => (
          <FocusFrame as="article" className="session-tile" key={s.id} hover radius={8.25}>
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
          </FocusFrame>
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
