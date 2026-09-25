import { cursorGeometry } from "./cursor-geometry";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  Check,
  Eye,
  Pause,
  Play,
  Radio,
  FileCode2,
} from "lucide-react";
import type { AppState } from "../shared/protocol";
import { initials } from "../shared/protocol";
function Code({ text }: { text: string }) {
  const parts = text.split(
    /(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:async|await|const|let|return|if|else|export|import|from|function|class|new|throw|try|catch|def|self|for|while|true|false|null|undefined|type|interface)\b|\b\d+\b)/g,
  );
  return (
    <>
      {parts.map((p, i) => (
        <span
          key={i}
          className={
            p.startsWith("//")
              ? "syntax-comment"
              : /^['"]/.test(p)
                ? "syntax-string"
                : /^\d+$/.test(p)
                  ? "syntax-number"
                  : /^(async|await|const|let|return|if|else|export|import|from|function|class|new|throw|try|catch|def|self|for|while|true|false|null|undefined|type|interface)$/.test(
                        p,
                      )
                    ? "syntax-keyword"
                    : undefined
          }
        >
          {p}
        </span>
      ))}
    </>
  );
}
export function LiveEditor({
  state,
  post,
}: {
  state: AppState;
  post: (m: any) => void;
}) {
  const [selected, setSelected] = useState("");
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(Date.now());
  const scroll = useRef<HTMLDivElement>(null);
  const person = state.session?.people.find((p) => p.id === state.following);
  const documents =
    state.session?.documents?.filter(
      (d) => !state.following || d.author === state.following,
    ) || [];
  const latest = [...documents].sort((a, b) => b.updated - a.updated)[0];
  const doc =
    (follow ? latest : documents.find((d) => d.key === selected)) || latest;
  const lines = useMemo(() => doc?.content.split("\n") || [], [doc?.content]);
  const currentLine = Math.min(doc?.line || 0, Math.max(0, lines.length - 1));
  const column = Math.min(doc?.column || 0, lines[currentLine]?.length || 0);
  const [cursor, setCursor] = useState({ x: 0, y: 0, height: 24 });
  const sheet = useRef<HTMLDivElement>(null);
  const [bubbleLeft, setBubbleLeft] = useState(false);
  const typing =
    !!doc && now - doc.updated < 1800 && person?.agent?.status === "running";
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    if (!doc || !sheet.current || !scroll.current) return;
    setSelected(doc.key);
    const container = sheet.current,
      view = scroll.current;
    let alive = true;
    const placeBubble = () => {
      const code = container.querySelectorAll<HTMLElement>(
        ".live-code-line code",
      )[currentLine];
      if (!code) return;
      const position = cursorGeometry(code, column, container);
      setBubbleLeft(position.x - view.scrollLeft > view.clientWidth - 190);
    };
    const measure = () => {
      if (!alive) return;
      const code = container.querySelectorAll<HTMLElement>(
        ".live-code-line code",
      )[currentLine];
      if (!code) return;
      const position = cursorGeometry(code, column, container);
      setCursor(position);
      if (follow) {
        const top = position.y,
          bottom = top + position.height;
        const vertical =
          top < view.scrollTop + position.height ||
          bottom > view.scrollTop + view.clientHeight - position.height;
        const horizontal =
          position.x < view.scrollLeft + 60 ||
          position.x > view.scrollLeft + view.clientWidth - 30;
        if (vertical || horizontal)
          view.scrollTo({
            top: vertical
              ? Math.max(0, top - view.clientHeight / 2)
              : view.scrollTop,
            left: horizontal
              ? Math.max(0, position.x - view.clientWidth / 2)
              : view.scrollLeft,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
          });
      }
      placeBubble();
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(container);
    resize.observe(view);
    document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    view.addEventListener("scroll", placeBubble, { passive: true });
    return () => {
      alive = false;
      resize.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
      view.removeEventListener("scroll", placeBubble);
    };
  }, [doc?.key, doc?.version, follow, currentLine, column, lines]);
  const conflict = state.liveConflicts?.find((c) => c.file === doc?.file);
  return (
    <div className="live-editor">
      <header className="live-editor-toolbar">
        <span className="live-follow-person" style={{ color: person?.color }}>
          <Radio size={14} />
          {person?.name || "Session"}’s agent
        </span>
        <span className="live-label">
          {typing
            ? "EDITING LIVE"
            : person?.agent?.status === "running"
              ? "RUNNING"
              : "LIVE VIEW"}
        </span>
        <span className="spacer" />
        {state.preview && (
          <>
            <span className="preview-tag">SAMPLE EDIT PLAYBACK</span>
            <button
              className="secondary small"
              onClick={() => post({ type: "returnPreview" })}
            >
              Back to workspace
            </button>
          </>
        )}
        <button
          className="secondary small"
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
        >
          {follow ? <Pause size={12} /> : <Play size={12} />}{" "}
          {follow ? "Pause following" : "Follow cursor"}
        </button>
        {doc && !doc.isolated && (
          <button
            className="secondary small"
            onClick={() =>
              post({ type: "openFile", file: doc.file, line: currentLine })
            }
          >
            Open local file <ArrowUpRight size={12} />
          </button>
        )}
      </header>
      <div className="live-file-tabs">
        {documents.map((d) => (
          <button
            key={d.key}
            className={d.key === doc?.key ? "active" : ""}
            onClick={() => {
              setFollow(false);
              setSelected(d.key);
            }}
          >
            <FileCode2 size={12} />
            {d.file.split("/").pop()}
            {d.isolated && <small>worktree</small>}
          </button>
        ))}
      </div>
      {doc ? (
        <>
          <div className="live-breadcrumb">
            <span>{doc.file}</span>
            <span className="spacer" />
            <span>
              {doc.runId.startsWith("human:") ? "Shared editor" : doc.provider}{" "}
              · revision {doc.version}
            </span>
          </div>
          {conflict && (
            <div className="live-conflict">
              <Eye size={13} />
              Live view continues. Local sync paused: {conflict.reason}.
            </div>
          )}
          <div className="live-code-scroll" ref={scroll}>
            <div className="live-code-sheet" ref={sheet}>
              {lines.map((line, i) => (
                <div
                  className={
                    "live-code-line " +
                    (i === currentLine && typing ? "agent-active-line" : "")
                  }
                  key={i}
                >
                  <span className="live-line-number">{i + 1}</span>
                  <code>
                    <Code text={line || " "} />
                  </code>
                </div>
              ))}
              <div
                className={"live-agent-cursor " + (typing ? "is-typing" : "")}
                data-testid="live-agent-cursor"
                style={
                  {
                    transform: `translate(${cursor.x}px,${cursor.y}px)`,
                    height: cursor.height,
                    "--person-color": person?.color || "#54b5f8",
                  } as React.CSSProperties
                }
              >
                <span className="live-caret" />
                <div
                  className={`live-cursor-bubble${bubbleLeft ? " bubble-left" : ""}`}
                >
                  {person?.avatar ? (
                    <img src={person.avatar} alt={person.name} />
                  ) : (
                    <span className="live-avatar-initials">
                      {initials(person?.name || "Agent")}
                    </span>
                  )}
                  <strong>{person?.name || "Agent"}</strong>
                  {typing && (
                    <span className="thinking-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <footer className="live-editor-footer">
            <Check size={11} />
            {doc.isolated
              ? "Isolated worktree · view only"
              : state.liveSync
                ? "Live file synchronization on"
                : "Live view · local synchronization paused"}
            <span className="spacer" />
            Ln {currentLine + 1}, Col {column + 1}
          </footer>
        </>
      ) : (
        <div className="empty">
          <Radio size={26} />
          <h3>Following {person?.name || "the agent"}.</h3>
          <p>
            The source file appears here as soon as this agent edits it. The
            avatar follows incoming changes smoothly.
          </p>
        </div>
      )}
    </div>
  );
}
