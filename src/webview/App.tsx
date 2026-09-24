import { readDraft, saveDraft } from "./persistence";
import React, { useState, useEffect, useRef } from "react";
import {
  Users,
  Activity,
  MessageSquare,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Plus,
  ArrowUp,
  Square,
  Settings,
  Copy,
  Check,
  X,
  ArrowRight,
  Code2,
  Folder,
  FileCode2,
  Search,
  PanelRight,
  Terminal,
  GitFork,
  Shield,
  Coins,
  BookOpen,
  ListTodo,
  Link,
  LogOut,
  RefreshCw,
  ExternalLink,
  CornerDownRight,
  Eye,
  Bot,
  MoreHorizontal,
  Radio,
  Command,
  Clock,
  Columns2,
} from "lucide-react";
import type {
  AppState,
  Person,
  Entry,
  SessionEvent,
  Provider,
} from "../shared/protocol";
import { initials } from "../shared/protocol";
type Post = (value: any) => void;
const num = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
const time = (v: number) =>
  new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function Avatar({
  person,
  size = 28,
}: {
  person: Person;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: person.color }}
      title={person.name}
    >
      {person.avatar && !failed ? (
        <img
          src={person.avatar}
          alt={person.name}
          onError={() => setFailed(true)}
        />
      ) : (
        initials(person.name)
      )}
      <i className={person.online ? "online" : "offline"} />
    </span>
  );
}
function Mark() {
  return (
    <span className="brand-mark">
      <svg
        viewBox="0 0 32 36"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 9.5 16 4V32L28 26.5V12.5L4 23.5ZM10 13.7 22 8.2V22.2L10 27.7Z" />
        <g fill="currentColor" stroke="none">
          {[
            [4, 9.5],
            [16, 4],
            [4, 23.5],
            [10, 13.7],
            [22, 8.2],
            [16, 18],
            [28, 12.5],
            [22, 22.2],
            [10, 27.7],
            [16, 32],
            [28, 26.5],
          ].map(([cx, cy]) => (
            <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="1.1" />
          ))}
        </g>
      </svg>
    </span>
  );
}
function IconButton({
  title,
  onClick,
  children,
  className = "",
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Empty({
  icon: Icon = Radio,
  title,
  children,
}: {
  icon?: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={26} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Section({
  label,
  icon: Icon,
  count,
  children,
  initial = false,
}: {
  label: string;
  icon: any;
  count?: number | string;
  children: React.ReactNode;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={"section " + (open ? "expanded" : "")}>
      <button
        className="section-heading"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={13} />
        <span>{label}</span>
        <small>{count}</small>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input,button,select")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href]",
          ) || [],
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-title">
          <h3>{title}</h3>
          <IconButton title="Close dialog" onClick={close}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export function App({
  state,
  mode,
  post,
}: {
  state: AppState;
  mode: "sidebar" | "composer" | "preview";
  post: Post;
}) {
  const [modal, setModal] = useState<"host" | "join" | "share" | null>(null);
  const [preferences, setPreferences] = useState(false);
  const [sensitivity, setSensitivity] = useState(
    state.conflictSensitivity || 6,
  );
  useEffect(() => {
    if (state.conflictSensitivity) setSensitivity(state.conflictSensitivity);
  }, [state.conflictSensitivity]);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState("");
  const [memory, setMemory] = useState("");
  const [selected, setSelected] = useState("");
  const [handoffTo, setHandoffTo] = useState("");
  const s = state.session;
  const me = s?.people.find((p) => p.id === state.me);
  const mine = me?.role !== "viewer";
  const event = (event: SessionEvent) => post({ type: "event", event });
  const pending = s?.approvals.filter((a) => a.status === "pending") || [];
  useEffect(() => {
    const f = (e: MessageEvent) => {
      if (e.data.type === "inviteCopied") setInviteCopied(true);
    };
    window.addEventListener("message", f);
    return () => window.removeEventListener("message", f);
  }, []);
  const sidebar = (
    <div className="sidebar">
      <header className="side-brand">
        <div>
          <Mark />
          <strong>
            lattice<span className="brand-suffix"> / session</span>
          </strong>
        </div>
        <div className="toolbar">
          <IconButton
            title="Edit your profile"
            onClick={() => post({ type: "profile" })}
          >
            <Users size={14} />
          </IconButton>
          <IconButton
            title="Session settings"
            onClick={() => post({ type: "settings" })}
          >
            <Settings size={14} />
          </IconButton>
        </div>
      </header>
      {!s ? (
        <div className="welcome">
          <div className="welcome-art">
            <div />
            <Mark />
            <div />
          </div>
          <div className="eyebrow">BETTER, TOGETHER</div>
          <h1>
            Your team.
            <br />
            One shared session.
          </h1>
          <p>
            See what everyone is building.
            <br />
            Bring your agents into the same room.
          </p>
          <button className="primary full" onClick={() => setModal("host")}>
            <Plus size={15} />
            Start a session
          </button>
          <button className="secondary full" onClick={() => setModal("join")}>
            <Link size={14} />
            Join with an invite
          </button>
          <div className="setup-note">
            <Shield size={14} />
            <span>
              Your agents run on your machine.
              <br />
              Your provider account stays yours.
            </span>
          </div>
          <div className="provider-status">
            {state.providers.map((p) => (
              <div key={p.id}>
                <i className={p.available ? "dot green" : "dot"} />
                {p.id === "codex" ? "Codex" : "Claude Code"}
                <span>{p.available ? "Detected" : "Not found"}</span>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() => post({ type: "providers" })}
            >
              Connect a provider <ArrowRight size={12} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="session-context">
            <div className="session-heading">
              <span className="live-dot" />
              <strong>{s.title}</strong>
              <button
                className="text-button"
                title="Return to your original project; keep, publish, or discard this session"
                onClick={() => post({ type: "leave" })}
              >
                <LogOut size={13} /> Return to project
              </button>
            </div>
            <div className="branch">
              <GitBranch size={12} />
              <span>{s.branch || "Local workspace"}</span>
              <button
                className="invite-button"
                onClick={() => setModal("share")}
              >
                <Plus size={12} />
                Invite
              </button>
            </div>
          </div>
          <div className="live-sync-toggle">
            <Radio size={12} />
            <span>Agent edits {state.liveSync ? "live" : "paused"}</span>
            <span className="spacer" />
            <button
              className="text-button"
              onClick={() => post({ type: "toggleLiveSync" })}
            >
              {state.liveSync ? "Pause sync" : "Resume sync"}
            </button>
          </div>
          {state.workspaceStatus && (
            <div className="workspace-status" role="status">
              {state.workspaceStatus}
            </div>
          )}
          {mode === "preview" && (
            <button
              className="coordination-setting"
              onClick={() => setPreferences(true)}
            >
              <Shield size={13} /> Conflict sensitivity{" "}
              <strong>{state.conflictSensitivity || 6}/10</strong>
            </button>
          )}
          {!!state.liveConflicts?.length && (
            <div className="inline-alert">
              {state.liveConflicts.length}{" "}
              {state.liveConflicts.length === 1
                ? "file update is"
                : "file updates are"}{" "}
              paused. Follow the agent to view live updates.
            </div>
          )}
          {!state.connected && (
            <div className="inline-alert">
              <Radio size={14} />
              Reconnecting to your session…
            </div>
          )}
          {pending.length > 0 && (
            <div className="attention-label">
              <Shield size={13} />
              {pending.length} {pending.length === 1 ? "decision" : "decisions"}{" "}
              waiting
            </div>
          )}
          {pending.map((a) => (
            <div className="approval-card" key={a.id}>
              <div className="row">
                <Shield size={13} />
                <strong>{a.title}</strong>
              </div>
              <small>
                {s.people.find((p) => p.id === a.owner)?.name}'s agent
              </small>
              <pre>{a.detail}</pre>
              {mine && (
                <div className="row">
                  <button
                    className="primary"
                    onClick={() =>
                      event({
                        type: "approval.decide",
                        id: a.id,
                        approve: true,
                      })
                    }
                  >
                    <Check size={13} />
                    Approve once
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      event({
                        type: "approval.decide",
                        id: a.id,
                        approve: false,
                      })
                    }
                  >
                    Deny
                  </button>
                </div>
              )}
            </div>
          ))}
          {state.brainStatus && (
            <div className="brain-status" role="status">
              {state.brainStatus}
            </div>
          )}
          {s.lifecycle && (
            <div className="session-actions">
              <button
                className="text-button"
                onClick={() => post({ type: "dashboard" })}
              >
                All sessions
              </button>
              {s.lifecycle.status === "attention" ? (
                <button
                  className="secondary small"
                  onClick={() => post({ type: "retryCoordination" })}
                >
                  Review update
                </button>
              ) : s.lifecycle.pullRequest ? (
                <button
                  className="secondary small"
                  onClick={() => post({ type: "openPR", id: s.id })}
                >
                  View PR
                </button>
              ) : (
                me?.role === "owner" && (
                  <button
                    className="secondary small"
                    onClick={() => post({ type: "finishSession" })}
                  >
                    Finish → Create PR
                  </button>
                )
              )}
            </div>
          )}
          {(s.guidance || [])
            .filter((g) => g.status === "approval" && g.to === state.me)
            .map((g) => (
              <div className="approval-card" key={g.id}>
                <strong>
                  {s.people.find((p) => p.id === g.from)?.name} wants to guide
                  your agent
                </strong>
                <p>{g.text}</p>
                <small>Continues on your provider account.</small>
                <div className="row">
                  <button
                    className="primary"
                    onClick={() =>
                      event({
                        type: "guidance.decide",
                        id: g.id,
                        approve: true,
                      })
                    }
                  >
                    Allow guidance
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      event({
                        type: "guidance.decide",
                        id: g.id,
                        approve: false,
                      })
                    }
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          {(s.guidance || [])
            .filter((g) => g.from === state.me && g.status === "approval")
            .map((g) => (
              <p className="section-hint" key={g.id}>
                Waiting for {s.people.find((p) => p.id === g.to)?.name} to
                approve your guidance.
              </p>
            ))}
          {s.handoffs
            .filter(
              (h) =>
                (!h.to || h.to === state.me) &&
                h.from !== state.me &&
                h.status === "pending",
            )
            .map((h) => (
              <div className="approval-card" key={h.id}>
                <strong>
                  {h.reason === "limit"
                    ? "Your teammate hit their limit"
                    : "Task handoff"}
                </strong>
                <p>{h.task}</p>
                <button
                  className="primary"
                  onClick={() => {
                    post({ type: "receiveHandoff", id: h.id });
                  }}
                >
                  {h.reason === "limit"
                    ? "Continue this task · your account"
                    : h.artifact
                      ? "Accept worktree & context"
                      : "Accept & prepare prompt"}
                </button>
                {h.to && (
                  <button
                    className="text-button"
                    onClick={() =>
                      event({ type: "handoff.decide", id: h.id, accept: false })
                    }
                  >
                    Decline
                  </button>
                )}
              </div>
            ))}
          <Section
            label="PEOPLE"
            icon={Users}
            count={`${s.people.filter((p) => p.online).length}/${s.people.length}`}
            initial
          >
            <div className="row" style={{ padding: "8px 14px" }}>
              <button
                className="secondary small"
                onClick={() => post({ type: "sessionTools" })}
              >
                Session tools
              </button>
              {mine && (
                <button
                  className="secondary small"
                  onClick={() => post({ type: "collaborate" })}
                >
                  Edit together
                </button>
              )}
            </div>
            {s.archived && (
              <p className="section-hint">
                Archived · reopen from Session tools to continue.
              </p>
            )}
            {!!state.collaborativeFiles?.length && (
              <p className="section-hint">
                Editing together: {state.collaborativeFiles.join(", ")}
              </p>
            )}
            {s.people.map((person) => (
              <div
                className={"person " + (!person.online ? "person-offline" : "")}
                key={person.id}
              >
                <div className="person-heading">
                  <Avatar person={person} />
                  <div>
                    <strong>
                      {person.name}
                      {person.id === state.me && (
                        <span className="muted"> (you)</span>
                      )}
                    </strong>
                    {person.identity && (
                      <small className="muted" title="Verified by GitHub">
                        @{person.identity.login} · verified
                      </small>
                    )}
                    <span className="person-view">
                      {person.file ? (
                        <button
                          onClick={() =>
                            post({
                              type: "openFile",
                              file: person.file,
                              line: person.line,
                            })
                          }
                        >
                          <Eye size={11} />
                          {person.file.split("/").pop()}
                          <small>:{(person.line || 0) + 1}</small>
                        </button>
                      ) : person.online ? (
                        "In the session"
                      ) : (
                        "Offline"
                      )}
                    </span>
                  </div>
                  <span className="role-label">
                    {person.role === "owner"
                      ? "host"
                      : person.role === "viewer"
                        ? "view"
                        : ""}
                  </span>
                </div>
                {person.agent ? (
                  <button
                    className={`agent-card ${person.agent.status}`}
                    style={{ borderLeftColor: person.color }}
                    onClick={() => {
                      setSelected(person.id);
                      post({ type: "selectLane", id: person.id });
                    }}
                  >
                    <div className="agent-top">
                      <span>
                        <Bot size={11} />
                        {person.agent.status === "running"
                          ? "Working"
                          : person.agent.status === "approval"
                            ? "Needs approval"
                            : person.agent.status === "done"
                              ? "Finished"
                              : person.agent.status}
                      </span>
                      <small>{person.agent.provider}</small>
                    </div>
                    <p>{person.agent.task}</p>
                    <div className="agent-detail">
                      {person.agent.status === "running" && (
                        <span className="thinking-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      {person.agent.detail || "Ready"}
                    </div>
                  </button>
                ) : (
                  <div
                    className="no-agent"
                    style={{ borderLeftColor: person.color + "44" }}
                  >
                    No agent running
                  </div>
                )}
                {person.agent && (
                  <button
                    className="follow-agent-button"
                    onClick={() => post({ type: "followAgent", id: person.id })}
                  >
                    <Eye size={12} />
                    Follow live edits <ExternalLink size={10} />
                  </button>
                )}
              </div>
            ))}
          </Section>
          <details
            className="session-details"
            open={mode === "preview" ? true : undefined}
          >
            <summary>Plan, memory & session details</summary>
            <Section
              label="PLAN"
              icon={ListTodo}
              count={`${s.plan.filter((p) => p.done).length}/${s.plan.length}`}
              initial={false}
            >
              {s.plan.length > 0 && (
                <div className="progress">
                  <i
                    style={{
                      width: `${(s.plan.filter((p) => p.done).length / s.plan.length) * 100}%`,
                    }}
                  />
                </div>
              )}
              {s.plan.map((p) => (
                <div className="plan-step" key={p.id}>
                  <input
                    aria-label={`Complete ${p.text}`}
                    type="checkbox"
                    checked={p.done}
                    disabled={
                      !mine || (p.owner !== state.me && me?.role !== "owner")
                    }
                    onChange={() =>
                      event({ type: "plan.update", id: p.id, done: !p.done })
                    }
                  />
                  <span className={p.done ? "completed" : ""}>{p.text}</span>
                  <small>
                    {s.people.find((x) => x.id === p.owner)?.name.split(" ")[0]}
                  </small>
                </div>
              ))}
              {mine && (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (plan.trim()) {
                      event({ type: "plan.add", text: plan });
                      setPlan("");
                    }
                  }}
                >
                  <input
                    aria-label="New plan step"
                    value={plan}
                    onChange={(e) => setPlan(e.target.value)}
                    placeholder="Add a step…"
                  />
                  <button aria-label="Add plan step">
                    <Plus size={14} />
                  </button>
                </form>
              )}
            </Section>
            <Section
              label="COMMENTS"
              icon={MessageSquare}
              count={s.comments.filter((n) => !n.resolved).length}
            >
              {s.comments.map((n) => (
                <div
                  key={n.id}
                  className={"note " + (n.resolved ? "resolved" : "")}
                >
                  <div className="row">
                    <small>
                      {s.people.find((p) => p.id === n.author)?.name}
                    </small>
                    {n.file && (
                      <button
                        className="file-link"
                        onClick={() =>
                          post({ type: "openFile", file: n.file, line: n.line })
                        }
                      >
                        {n.file.split("/").pop()}:{(n.line || 0) + 1}
                      </button>
                    )}
                  </div>
                  <p>{n.text}</p>
                  {n.stale && (
                    <span className="stale-note">
                      Code changed · review this note
                    </span>
                  )}
                  {n.stale && mine && (
                    <button
                      className="text-button"
                      onClick={() => post({ type: "reviewMemory", id: n.id })}
                    >
                      Review note
                    </button>
                  )}
                  {mine && (
                    <button
                      className="text-button"
                      onClick={() =>
                        event({
                          type: "note.resolve",
                          kind: "comments",
                          id: n.id,
                        })
                      }
                    >
                      {n.resolved ? "Reopen" : "Resolve"}
                    </button>
                  )}
                </div>
              ))}
              {mine && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (note.trim()) {
                      event({
                        type: "note.add",
                        kind: "comments",
                        text: note,
                        file: state.file,
                      });
                      setNote("");
                    }
                  }}
                >
                  <textarea
                    aria-label="Session comment"
                    placeholder="Leave a note for the team…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className="secondary small">Comment</button>
                </form>
              )}
            </Section>
            <Section
              label="FILE CHANGES"
              icon={FileCode2}
              count={
                s.files?.filter(
                  (f) => f.author !== state.me && !f.receipts[state.me],
                ).length || 0
              }
            >
              <p className="section-hint">
                Share a saved, tracked file. Teammates review and apply changes
                to their own checkout.
              </p>
              {mine && (
                <button
                  className="secondary small"
                  onClick={() => post({ type: "shareFile" })}
                >
                  <Plus size={12} />
                  Share current file
                </button>
              )}
              {(s.files || []).map((f) => (
                <div className="note shared-file" key={f.id}>
                  <div className="row">
                    <FileCode2 size={12} />
                    <strong>{f.file}</strong>
                  </div>
                  <small>
                    {s.people.find((p) => p.id === f.author)?.name ||
                      "Participant"}{" "}
                    · {time(f.time)}
                  </small>
                  {f.receipts[state.me] && (
                    <div className="file-receipt">
                      {f.receipts[state.me] === "applied"
                        ? "Applied to your checkout"
                        : "Dismissed"}
                    </div>
                  )}
                  <div className="row file-actions">
                    <button
                      className="secondary small"
                      onClick={() => post({ type: "reviewFile", id: f.id })}
                    >
                      Review diff
                    </button>
                    {mine &&
                      f.author !== state.me &&
                      f.receipts[state.me] !== "applied" && (
                        <button
                          className="primary small"
                          disabled={!state.reviewedFiles?.includes(f.id)}
                          title={
                            state.reviewedFiles?.includes(f.id)
                              ? "Apply this reviewed version"
                              : "Review the diff first"
                          }
                          onClick={() => post({ type: "applyFile", id: f.id })}
                        >
                          Apply reviewed
                        </button>
                      )}
                    {mine && f.author !== state.me && !f.receipts[state.me] && (
                      <button
                        className="text-button"
                        onClick={() =>
                          event({
                            type: "file.receipt",
                            id: f.id,
                            hash: f.hash,
                            status: "dismissed",
                          })
                        }
                      >
                        Dismiss
                      </button>
                    )}
                    {mine &&
                      (f.author === state.me || me?.role === "owner") && (
                        <button
                          className="text-button"
                          onClick={() =>
                            event({ type: "file.withdraw", id: f.id })
                          }
                        >
                          Withdraw
                        </button>
                      )}
                  </div>
                  {f.author === state.me &&
                    Object.entries(f.receipts).map(([id, status]) => (
                      <small className="file-receipt" key={id}>
                        {s.people.find((p) => p.id === id)?.name ||
                          "Participant"}{" "}
                        · {status}
                      </small>
                    ))}
                </div>
              ))}
              {!s.files?.length && (
                <p className="section-hint">No files shared yet.</p>
              )}
            </Section>
            <Section
              label="TASK WORKTREES"
              icon={GitFork}
              count={state.worktrees?.length || 0}
            >
              {s.tasks
                ?.filter((t) => ["running", "approval"].includes(t.status))
                .map((task) => (
                  <div className="note" key={task.runId}>
                    <strong>
                      {s.people.find((p) => p.id === task.owner)?.name} ·{" "}
                      {task.provider}
                    </strong>
                    <p>{task.task}</p>
                    <small>{task.detail}</small>
                    <div className="row">
                      <button
                        className="text-button"
                        onClick={() =>
                          post({
                            type: "taskConversation",
                            id: task.runId,
                            owner: task.owner,
                          })
                        }
                      >
                        View logs
                      </button>
                      {mine &&
                        task.provider === "codex" &&
                        task.status === "running" && (
                          <button
                            className="text-button"
                            onClick={() =>
                              post({ type: "guideTask", id: task.runId })
                            }
                          >
                            Guide
                          </button>
                        )}
                    </div>
                    {task.owner === state.me && task.isolated && (
                      <button
                        className="text-button"
                        onClick={() =>
                          post({ type: "stopTask", id: task.runId })
                        }
                      >
                        Stop this task
                      </button>
                    )}
                    {task.owner !== state.me && mine && (
                      <button
                        className="text-button"
                        onClick={() =>
                          event({
                            type: "guidance.send",
                            to: task.owner,
                            runId: task.runId,
                            action: "stop",
                            text: "",
                          })
                        }
                      >
                        Stop task
                      </button>
                    )}
                  </div>
                ))}
              {!state.worktrees?.length ? (
                <p className="section-hint">
                  Turn on Worktree in the composer to run a task separately.
                </p>
              ) : (
                state.worktrees.map((t) => (
                  <div className="note" key={t.id}>
                    <div className="row">
                      <GitBranch size={12} />
                      <strong>{t.branch}</strong>
                    </div>
                    <small>{t.status}</small>
                    <div className="row">
                      {t.status === "review" && (
                        <>
                          <button
                            className="secondary small"
                            onClick={() =>
                              post({ type: "checkTree", id: t.id })
                            }
                          >
                            Run checks
                          </button>
                          <button
                            className="secondary small"
                            onClick={() =>
                              post({ type: "handoffTask", id: t.id })
                            }
                          >
                            Hand off
                          </button>
                        </>
                      )}
                      <button
                        className="secondary small"
                        onClick={() => post({ type: "reviewTree", id: t.id })}
                      >
                        Review diff
                      </button>
                      {t.status === "review" && (
                        <button
                          className="secondary small"
                          onClick={() =>
                            post({ type: "integrateTree", id: t.id })
                          }
                        >
                          Integrate
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </Section>
            <Section
              label="ACTIVITY"
              icon={Activity}
              count={s.entries.filter((e) => e.kind !== "agent").length}
            >
              <div className="activity-feed">
                {s.entries
                  .filter((e) => e.kind !== "agent")
                  .slice(-50)
                  .reverse()
                  .map((e) => (
                    <div className="activity-entry" key={e.id}>
                      <i />
                      <div>
                        <strong>
                          {s.people.find((p) => p.id === e.actor)?.name ||
                            "Session"}
                        </strong>
                        <span>{e.text}</span>
                        <small>{time(e.time)}</small>
                      </div>
                    </div>
                  ))}
              </div>
            </Section>
            <Section
              label="USAGE"
              icon={Coins}
              count={num(
                s.people.reduce(
                  (v, p) => v + p.usage.input + p.usage.output,
                  0,
                ),
              )}
            >
              <div className="usage-header">
                <span>Participant</span>
                <span>Input / output</span>
              </div>
              {s.people.map((p) => (
                <div className="usage-row" key={p.id}>
                  <Avatar person={p} size={20} />
                  <span>{p.name}</span>
                  <code>
                    {num(p.usage.input)} / {num(p.usage.output)}
                  </code>
                </div>
              ))}
              <p className="section-hint">
                {s.budget?.tokens
                  ? `Budget: ${num(s.budget.tokens)} tokens. `
                  : ""}
                Provider-reported tokens for this session.{" "}
                {s.people.some((p) => p.usage.cost !== undefined)
                  ? `Reported cost: $${s.people.reduce((v, p) => v + (p.usage.cost || 0), 0).toFixed(4)}.`
                  : "Subscription balance is not available."}
              </p>
            </Section>
            <Section
              label="SHARED MEMORY"
              icon={BookOpen}
              count={s.memories.filter((n) => !n.resolved).length}
            >
              <button
                className="text-button"
                onClick={() => post({ type: "searchMemory" })}
              >
                Search memory
              </button>
              {s.memories
                .filter((n) => !n.resolved)
                .map((n) => (
                  <div className="note" key={n.id}>
                    <p>{n.text}</p>
                    {n.stale && (
                      <span className="stale-note">
                        Code changed · review this note
                      </span>
                    )}
                    {n.file && <small>{n.file}</small>}
                    {n.stale && mine && (
                      <button
                        className="text-button"
                        onClick={() => post({ type: "reviewMemory", id: n.id })}
                      >
                        Review memory
                      </button>
                    )}
                    {mine && (
                      <button
                        className="text-button"
                        onClick={() =>
                          event({
                            type: "note.resolve",
                            kind: "memories",
                            id: n.id,
                          })
                        }
                      >
                        Retire
                      </button>
                    )}
                  </div>
                ))}
              {mine && (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (memory.trim()) {
                      event({
                        type: "note.add",
                        kind: "memories",
                        text: memory,
                        file: state.file,
                      });
                      setMemory("");
                    }
                  }}
                >
                  <input
                    aria-label="Shared memory"
                    placeholder="Remember a decision…"
                    value={memory}
                    onChange={(e) => setMemory(e.target.value)}
                  />
                  <button aria-label="Add memory">
                    <Plus size={14} />
                  </button>
                </form>
              )}
            </Section>
            {mine &&
              s.people.filter((p) => p.id !== state.me && p.role !== "viewer")
                .length > 0 && (
                <div className="handoff-row">
                  <select
                    aria-label="Handoff recipient"
                    value={handoffTo}
                    onChange={(e) => setHandoffTo(e.target.value)}
                  >
                    <option value="">Hand off work…</option>
                    {s.people
                      .filter((p) => p.id !== state.me && p.role !== "viewer")
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <IconButton
                    title="Offer task handoff"
                    onClick={() => {
                      if (handoffTo)
                        event({
                          type: "handoff.add",
                          to: handoffTo,
                          task: state.run?.task || s.title,
                        });
                    }}
                  >
                    <ArrowRight size={14} />
                  </IconButton>
                </div>
              )}
          </details>
          <footer className="side-footer">
            <span className={state.connected ? "dot green" : "dot"} />
            {state.connected ? "Connected" : "Offline"}
            <span className="spacer" />
            <span>{s.people.length} in this session</span>
          </footer>
        </>
      )}
    </div>
  );
  return (
    <>
      {state.error && (
        <div className="error-toast" role="alert">
          <span>{state.error}</span>
          <IconButton
            title="Dismiss"
            onClick={() => post({ type: "clearError" })}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {mode === "sidebar" ? (
        sidebar
      ) : mode === "composer" ? (
        <Composer state={state} post={post} selected={selected} />
      ) : (
        <PreviewShell state={state} post={post} sidebar={sidebar}>
          <Composer state={state} post={post} selected={selected} />
        </PreviewShell>
      )}
      {modal && (
        <Modal
          title={
            modal === "host"
              ? "Start a session"
              : modal === "join"
                ? "Join your team"
                : "Invite to session"
          }
          close={() => setModal(null)}
        >
          {modal === "host" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                post({
                  type: "host",
                  title: title || "Working session",
                  sensitivity,
                });
                setModal(null);
              }}
            >
              <label>
                What are you building?
                <input
                  autoFocus
                  placeholder="e.g. Fix the lobby join race"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                />
              </label>
              <div className="repo-choice">
                <GitBranch size={15} />
                <span>
                  {state.repo.split("/").pop() || "Current workspace"}
                  <small>{state.branch || "Current branch"}</small>
                </span>
              </div>
              <p className="modal-note">
                Your project files become the session’s live workspace.
                Teammates open it automatically when they join. Dependencies,
                local credentials and ignored files stay on your machine.
              </p>
              {mode === "preview" && (
                <Sensitivity value={sensitivity} change={setSensitivity} />
              )}
              <button className="primary full">
                Create session <ArrowRight size={14} />
              </button>
            </form>
          ) : modal === "join" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                post({ type: "join", link, sensitivity });
                setModal(null);
              }}
            >
              <label>
                Session invitation
                <textarea
                  placeholder="Paste your session invitation"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  required
                />
              </label>
              <p className="modal-note">
                The host’s live workspace opens in a new VS Code window. No
                clone or pull needed. Your agent runs locally using your
                connected account.
              </p>
              {mode === "preview" && (
                <Sensitivity value={sensitivity} change={setSensitivity} />
              )}
              <button className="primary full">
                Join session <ArrowRight size={14} />
              </button>
            </form>
          ) : (
            <>
              <p className="modal-note">
                An invite grants access to this session's presence,
                conversations and activity.
              </p>
              {me?.role === "owner" ? (
                <>
                  <label>
                    Invite as
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as any)}
                    >
                      <option value="editor">
                        Editor · run agents and answer approvals
                      </option>
                      <option value="viewer">
                        Viewer · follow the session
                      </option>
                    </select>
                  </label>
                  <button
                    className="primary full"
                    onClick={() => {
                      post({ type: "invite", role });
                    }}
                  >
                    {inviteCopied ? <Check size={14} /> : <Copy size={14} />}
                    Copy invitation
                  </button>
                </>
              ) : (
                <p>Ask the session host for an invitation.</p>
              )}
              <div className="eyebrow mt">PEOPLE WITH ACCESS</div>
              {s?.people.map((p) => (
                <div className="member-row" key={p.id}>
                  <Avatar person={p} size={24} />
                  <span>{p.name}</span>
                  {me?.role === "owner" && p.role !== "owner" ? (
                    <select
                      aria-label={`Role for ${p.name}`}
                      value={p.role}
                      onChange={(e) =>
                        event({
                          type: "role",
                          personId: p.id,
                          role: e.target.value as any,
                        })
                      }
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <small>{p.role}</small>
                  )}
                </div>
              ))}
            </>
          )}
        </Modal>
      )}
      {(preferences || (state.onboarding && !!s && mode !== "composer")) && (
        <Modal
          title="How cautious should Lattice be?"
          close={() => {
            if (!state.onboarding) setPreferences(false);
          }}
        >
          <Sensitivity value={sensitivity} change={setSensitivity} />
          <button
            className="primary full"
            onClick={() => {
              post({ type: "sensitivity", value: sensitivity });
              setPreferences(false);
            }}
          >
            Save preference
          </button>
        </Modal>
      )}
    </>
  );
}
function Sensitivity({
  value,
  change,
}: {
  value: number;
  change: (value: number) => void;
}) {
  return (
    <div className="sensitivity-control">
      <label htmlFor="conflict-sensitivity">
        Conflict sensitivity <output>{value} / 10</output>
      </label>
      <input
        id="conflict-sensitivity"
        type="range"
        min="1"
        max="10"
        step="1"
        value={value}
        aria-label="Conflict sensitivity"
        aria-valuetext={`${value} out of 10`}
        onChange={(e) => change(Number(e.target.value))}
      />
      <div className="sensitivity-scale">
        <span>1 · Fewer interruptions</span>
        <span>10 · More cautious</span>
      </div>
      <p>
        Before an agent starts, check its prompt against active work. Higher
        settings flag broader overlaps. Clear file conflicts are flagged at
        every level.
      </p>
    </div>
  );
}
function Composer({
  state,
  post,
  selected,
}: {
  state: AppState;
  post: Post;
  selected: string;
}) {
  const [draft, setDraft] = useState(readDraft);
  const [advanced, setAdvanced] = useState(false);
  const laneDrafts = useRef<Record<string, string>>({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const laneRef = useRef(state.me);
  const switchLane = (id: string) => {
    if (id === laneRef.current) return;
    laneDrafts.current[laneRef.current] = draftRef.current;
    laneRef.current = id;
    setLane(id);
    setDraft(laneDrafts.current[id] || "");
  };
  useEffect(() => saveDraft(draft), [draft]);
  const [provider, setProvider] = useState<Provider>("codex");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<"ask" | "read-only">("ask");
  const [isolated, setIsolated] = useState(false);
  const [intent, setIntent] = useState("prompt");
  const [lane, setLane] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [tab, setTab] = useState("agent");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const s = state.session;
  const me = s?.people.find((p) => p.id === state.me);
  const running =
    state.run && ["running", "approval"].includes(state.run.status);
  const person = s?.people.find((p) => p.id === (lane || selected || state.me));
  const remote = !!person && person.id !== state.me;
  const remoteRunning =
    remote &&
    person?.online &&
    person.agent &&
    ["running", "approval"].includes(person.agent.status);
  const selectedRunning = remote ? remoteRunning : running;
  const selectedProvider = remote
    ? person?.agent?.provider
    : state.run?.provider;
  const sendRemote = (action: "steer" | "stop", text = "") => {
    if (person?.agent)
      post({
        type: "event",
        event: {
          type: "guidance.send",
          to: person.id,
          runId: person.agent.runId,
          action,
          text,
        },
      });
  };
  const entries =
    s?.entries.filter((e) =>
      tab === "activity"
        ? e.kind !== "agent"
        : e.actor === (lane || selected || state.me) &&
          e.kind !== "system" &&
          (!taskFilter || e.runId === taskFilter),
    ) || [];
  useEffect(() => {
    if (selected) switchLane(selected);
  }, [selected]);
  useEffect(() => {
    const f = (e: MessageEvent) => {
      if (e.data.type === "draft") {
        setDraft(e.data.text);
        input.current?.focus();
      }
      if (e.data.type === "selectLane") {
        switchLane(e.data.id);
        setTaskFilter("");
      }
      if (e.data.type === "taskConversation") {
        switchLane(e.data.owner);
        setTaskFilter(e.data.id);
      }
    };
    window.addEventListener("message", f);
    return () => window.removeEventListener("message", f);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length, entries.at(-1)?.text]);
  const submit = () => {
    if (
      !draft.trim() ||
      !state.connected ||
      me?.role === "viewer" ||
      (intent !== "chat" && remote && !remoteRunning)
    )
      return;
    const text = draft;
    setDraft("");
    if (intent === "chat")
      post({ type: "event", event: { type: "entry", kind: "message", text } });
    else if (remote) sendRemote("steer", text);
    else if (running && !isolated) post({ type: "steer", text });
    else post({ type: "run", prompt: text, provider, model, mode, isolated });
    if (!remote) setLane(state.me);
  };
  return (
    <div className="composer-view">
      <div className="panel-tabs">
        <button
          className={tab === "agent" ? "active" : ""}
          onClick={() => setTab("agent")}
        >
          <Bot size={14} />
          AGENT<span className="live-label">{running ? "LIVE" : "READY"}</span>
        </button>
        <button
          className={tab === "activity" ? "active" : ""}
          onClick={() => setTab("activity")}
        >
          <Activity size={13} />
          SESSION LOG
        </button>
        <span className="spacer" />
        <button onClick={() => post({ type: "providers" })}>
          <Plus size={13} />
          Connect
        </button>
      </div>
      {s ? (
        <>
          <div className="lane-bar">
            {person && <Avatar person={person} size={21} />}
            <select
              aria-label="Agent conversation"
              value={lane || selected || state.me}
              onChange={(e) => {
                switchLane(e.target.value);
                setTaskFilter("");
              }}
            >
              {s.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === state.me ? "My agent" : `${p.name}'s agent`}
                </option>
              ))}
            </select>
            {!!s.tasks?.some((task) => task.owner === person?.id) && (
              <select
                aria-label="Filter transcript by task"
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              >
                <option value="">All task logs</option>
                {s.tasks
                  ?.filter((task) => task.owner === person?.id)
                  .map((task) => (
                    <option key={task.runId} value={task.runId}>
                      {task.provider} · {task.task.slice(0, 40)}
                    </option>
                  ))}
              </select>
            )}
            <span className="spacer" />
            {person?.id !== state.me && (
              <button
                className="secondary small"
                onClick={() => switchLane(state.me)}
              >
                <CornerDownRight size={12} />
                My agent
              </button>
            )}
            <span className="muted small-text">
              {person?.agent?.provider || "No agent deployed"}
            </span>
          </div>
          <div className="transcript" aria-label="Agent transcript">
            {!entries.length ? (
              <Empty icon={Bot} title="One composer. Your connected agents.">
                Choose Claude or Codex below, then tell your agent what to
                build.
              </Empty>
            ) : (
              entries.map((e) => (
                <TranscriptEntry
                  key={e.id}
                  entry={e}
                  person={s.people.find((p) => p.id === e.actor)}
                />
              ))
            )}
            {running && person?.id === state.me && (
              <div className="running-line">
                <span className="thinking-dots">
                  <i />
                  <i />
                  <i />
                </span>
                {state.run?.status === "approval"
                  ? "Waiting for approval…"
                  : "Working in your repository…"}
              </div>
            )}
            <div ref={end} />
          </div>
          <div className="compose-wrap">
            <div className="prompt-box">
              <textarea
                ref={input}
                aria-label="Prompt your agent"
                placeholder={
                  me?.role === "viewer"
                    ? "You’re watching this session."
                    : intent === "chat"
                      ? "Message everyone in this session…"
                      : remote
                        ? remoteRunning
                          ? `Guide ${person?.name}’s agent…`
                          : "Follow this conversation, or switch to My agent to send a prompt."
                        : running
                          ? "Guide your running agent…"
                          : `Ask ${provider === "codex" ? "Codex" : "Claude"} to build, fix, or explore…`
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
                disabled={me?.role === "viewer"}
              />
              {remote && (
                <div className="steering-label">
                  Guiding {person?.name} · uses their account
                  {me?.role !== "owner" && " · approval required"}
                </div>
              )}
              <div
                className={
                  "compose-controls " + (advanced ? "advanced" : "simple")
                }
              >
                <button
                  className="icon-button"
                  aria-label="More agent options"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  <MoreHorizontal size={15} />
                </button>
                <div className="control-pill">
                  <Shield size={12} />
                  <select
                    aria-label="Agent permission mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                    disabled={remote || (!!running && !isolated)}
                  >
                    <option value="ask">Ask permission</option>
                    <option value="read-only">Read only</option>
                  </select>
                </div>
                <div className="control-pill provider-pill">
                  <Bot size={12} />
                  <select
                    aria-label="AI provider"
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value as Provider);
                      setModel("");
                    }}
                    disabled={remote || (!!running && !isolated)}
                  >
                    <option value="codex">Codex</option>
                    <option value="claude">Claude Code</option>
                  </select>
                </div>
                <input
                  className="model-input"
                  aria-label="Model override"
                  placeholder="Default model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={remote || (!!running && !isolated)}
                />
                <span className="spacer" />
                <button
                  className={"worktree-toggle " + (isolated ? "on" : "")}
                  title="Run another agent in its own Git worktree (up to four agents)"
                  aria-pressed={isolated}
                  onClick={() => setIsolated(!isolated)}
                  disabled={remote}
                >
                  <GitFork size={13} />
                  <span>Worktree</span>
                </button>
                <select
                  className="intent"
                  aria-label="Message intent"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                >
                  <option value="prompt">
                    {isolated && !remote
                      ? "New task"
                      : selectedRunning
                        ? "Steer"
                        : "Prompt"}
                  </option>
                  <option value="chat">Team chat</option>
                </select>
                {selectedRunning && (
                  <button
                    className="send-button"
                    aria-label="Send guidance"
                    disabled={!draft.trim()}
                    onClick={submit}
                  >
                    <ArrowUp size={17} />
                  </button>
                )}
                {selectedRunning && me?.role !== "viewer" ? (
                  <IconButton
                    title={remote ? "Stop teammate’s agent" : "Stop agent"}
                    className="stop-button"
                    onClick={() =>
                      remote ? sendRemote("stop") : post({ type: "stop" })
                    }
                  >
                    <Square size={13} fill="currentColor" />
                  </IconButton>
                ) : (
                  <button
                    className="send-button"
                    aria-label="Send prompt"
                    disabled={
                      !draft.trim() ||
                      me?.role === "viewer" ||
                      !state.connected ||
                      (remote && intent !== "chat" && !remoteRunning)
                    }
                    onClick={submit}
                  >
                    <ArrowUp size={17} />
                  </button>
                )}
              </div>
            </div>
            <div className="compose-caption">
              <GitBranch size={10} />
              <span>
                {isolated
                  ? "Separate worktree"
                  : s.branch || "Current workspace"}
              </span>
              <span className="divider">/</span>
              <span>
                {intent === "chat"
                  ? "Message · no agent usage"
                  : remote
                    ? `${person?.name} remains the agent sponsor`
                    : `Uses your ${provider === "codex" ? "Codex" : "Claude"} account`}
              </span>
              <span className="spacer" />
              <span>↵ send · ⇧↵ newline</span>
            </div>
          </div>
        </>
      ) : (
        <Empty icon={Bot} title="Your agents belong here.">
          Start or join a session in the Lattice sidebar to connect your
          workflow.
        </Empty>
      )}
    </div>
  );
}
function TranscriptEntry({
  entry: e,
  person,
}: {
  entry: Entry;
  person?: Person;
}) {
  const [open, setOpen] = useState(false);
  if (e.kind === "tool")
    return (
      <div className="tool-entry">
        <button onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Terminal size={12} />
          <code>{e.text.split("\n")[0].slice(0, 130)}</code>
          <span className="spacer" />
          <small>{time(e.time)}</small>
        </button>
        {open && <pre>{e.text}</pre>}
      </div>
    );
  return (
    <article className={"transcript-entry " + e.kind}>
      <div className="entry-heading">
        {person && <Avatar person={person} size={20} />}
        <strong>
          {e.kind === "agent"
            ? `${person?.name || "Your"}’s agent`
            : person?.name || "Session"}
        </strong>
        {e.provider && <span className="provider-label">{e.provider}</span>}
        <small>{time(e.time)}</small>
      </div>
      <div className="entry-body">{e.text}</div>
    </article>
  );
}
const previewFiles = [
  "src/lobby/join.ts",
  "src/lobby/matchmaker.ts",
  "src/lobby/slots.ts",
  "src/net/session_store.ts",
  "src/net/packet.ts",
  "tests/lobby/join.test.ts",
  "package.json",
  "README.md",
];
const source = `export const store = {\n  async readLobby(id: LobbyId) {\n    return db.lobbies.findOne({ id });\n  },\n\n  async reserveSlot(req: ReserveRequest) {\n    // compare-and-set on the lobby revision\n    const written = await db.lobbies.updateOne(\n      { id: req.lobbyId, revision: req.expectRevision },\n      { $set: { [\"slots.\" + req.slot]: req.playerId },\n        $inc: { revision: 1 } },\n    );\n\n    if (written.matched === 0) {\n      return { ok: false, reason: \"stale_revision\" };\n    }\n\n    return { ok: true, result: { slot: req.slot } };\n  },\n};`;
function PreviewShell({
  state,
  post,
  sidebar,
  children,
}: {
  state: AppState;
  post: Post;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [file, setFile] = useState("src/net/session_store.ts");
  return (
    <div className="preview-shell">
      <header className="window-title">
        <div className="traffic">
          <i />
          <i />
          <i />
        </div>
        <div className="title-search">
          <Search size={12} />
          <span>northlight / multiplayer-session</span>
          <kbd>⌘K</kbd>
        </div>
        <div className="title-logo">
          <Mark />
          lattice
        </div>
        <span className="preview-tag">INTERACTIVE DESIGN PREVIEW</span>
      </header>
      <div className="workspace-bar">
        <Mark />
        <strong>{state.session?.title || "Shared workspace"}</strong>
        <span className="branch">
          <GitBranch size={13} />
          {state.branch}
        </span>
        <span className="spacer" />
        <button
          className="secondary small"
          onClick={() => post({ type: "invite" })}
        >
          <Users size={13} />
          Invite
        </button>
      </div>
      <div className="preview-body">
        <nav className="activity-rail">
          <IconButton title="Sessions" onClick={() => {}}>
            <Columns2 size={21} />
          </IconButton>
          <IconButton title="Explorer" onClick={() => {}} className="chosen">
            <FileCode2 size={21} />
          </IconButton>
          <GitBranch size={21} />
          <MessageSquare size={21} />
          <span className="spacer" />
          <Settings size={20} />
        </nav>
        <aside className="file-explorer">
          <div className="eyebrow">
            EXPLORER
            <MoreHorizontal size={14} />
          </div>
          <div className="repo-name">
            <ChevronDown size={12} />
            NORTHLIGHT
          </div>
          {previewFiles.map((f, i) => (
            <React.Fragment key={f}>
              {[0, 3, 5].includes(i) && (
                <div className="folder">
                  <ChevronDown size={12} />
                  <Folder size={13} />
                  {i === 0 ? "src / lobby" : i === 3 ? "net" : "tests / lobby"}
                </div>
              )}
              <button
                className={"file-row " + (file === f ? "selected" : "")}
                onClick={() => {
                  setFile(f);
                  post({ type: "previewFile", file: f });
                }}
              >
                <FileCode2 size={13} />
                <span>{f.split("/").pop()}</span>
                <div className="file-presence">
                  {state.session?.people
                    .filter((p) => p.file === f)
                    .map((p) => (
                      <Avatar key={p.id} person={p} size={17} />
                    ))}
                </div>
                {i < 6 && <small>M</small>}
              </button>
            </React.Fragment>
          ))}
        </aside>
        <main className="editor-and-agent">
          <div className="editor-tabs">
            {[
              "src/lobby/join.ts",
              "src/net/session_store.ts",
              "tests/lobby/join.test.ts",
            ].map((f) => (
              <button
                className={file === f ? "active" : ""}
                key={f}
                onClick={() => setFile(f)}
              >
                <FileCode2 size={12} />
                {f.split("/").pop()}
                {state.session?.people
                  .filter((p) => p.file === f)
                  .slice(0, 1)
                  .map((p) => (
                    <Avatar key={p.id} person={p} size={17} />
                  ))}
              </button>
            ))}
          </div>
          <div className="breadcrumbs">
            {file}
            <span className="spacer" />
            <Check size={11} /> rev 47
          </div>
          <div className="code-editor">
            <div className="code-lines">
              {source.split("\n").map((line, i) => (
                <div
                  className={"code-line " + (i === 7 ? "current-line" : "")}
                  key={i}
                >
                  <span className="line-number">{i + 1}</span>
                  <code
                    className={
                      line.trim().startsWith("//") ? "code-comment" : ""
                    }
                  >
                    {line || " "}
                  </code>
                  {i === 7 && (
                    <span className="cursor-tag">
                      {state.session?.people[1]?.name} · agent
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="minimap">
              {source.split("\n").map((s, i) => (
                <i key={i} style={{ width: Math.max(8, s.length) + "%" }} />
              ))}
            </div>
          </div>
          <div className="preview-agent">{children}</div>
        </main>
        <aside className="preview-sidebar">{sidebar}</aside>
      </div>
      <footer className="statusbar">
        <GitBranch size={11} />
        {state.branch}
        <span className="divider">/</span>
        <Radio size={11} />
        Session connected
        <span className="spacer" />
        TypeScript<span className="divider">UTF-8</span>
        <span>Ln 8, Col 5</span>
      </footer>
    </div>
  );
}
