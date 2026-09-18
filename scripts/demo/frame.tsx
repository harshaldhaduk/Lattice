import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/webview/App";
import { LiveEditor } from "../../src/webview/LiveEditor";
import type { AppState } from "../../src/shared/protocol";
import "../../src/webview/styles.css";
import "./frame.css";

const id = new URLSearchParams(location.search).get("person") || "alice";
const initial: AppState = { me: "", connected: false, repo: "northlight/lobby-service", branch: "fix/concurrent-join", providers: [{ id: "codex", available: true }, { id: "claude", available: true }] };
const base = `export async function reserveSlot(req: JoinRequest) {\n  const lobby = await db.lobbies.findOne({\n    id: req.lobbyId,\n  });\n\n  // Two joins can read the same revision.\n  await db.lobbies.updateOne(\n    { id: req.lobbyId },\n    { $set: { [req.slot]: req.playerId } },\n  );\n\n  return { ok: true };\n}`;
const tests = `describe("concurrent lobby joins", () => {\n  it("reserves a seat only once", async () => {\n    const lobby = await createLobby();\n\n    // Regression coverage goes here.\n    const result = await join(lobby);\n\n    expect(result.ok).toBe(true);\n  });\n});`;
function DemoFrame() {
  const [state, setState] = useState(initial);
  const [view, setView] = useState("source");
  const [following, setFollowing] = useState("");
  const [file, setFile] = useState(id === "alice" ? "tests/join.test.ts" : "src/session_store.ts");
  React.useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.data.type === "demoState") setState(event.data.state);
      if (event.data.type === "demoView") { setView(event.data.view); if (event.data.following) setFollowing(event.data.following); }
    };
    window.addEventListener("message", message);
    void fetch(`/state/${id}`).then(r => r.json()).then(setState);
    return () => window.removeEventListener("message", message);
  }, []);
  const post = async (action: any) => {
    if (action.type === "followAgent") { setFollowing(action.id); setView("live"); }
    if (action.type === "selectLane") window.postMessage({ type: "selectLane", id: action.id }, location.origin);
    const response = await fetch(`/action/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
    const result = await response.json();
    if (action.type === "invite") window.postMessage({ type: "inviteCopied" }, location.origin);
    if (result.error) console.error(result.error);
  };
  const mine = state.session?.people.find(p => p.id === state.me);
  const filePeople = state.session?.people.filter(p => p.file === file) || [];
  const code = file.includes("test") ? tests : base;
  return <div className="demo-workspace">
    <div className="demo-titlebar"><span className="traffic"><i/><i/><i/></span><span>northlight / lobby-service</span><span className="demo-title-right">⌘ K</span></div>
    <div className="demo-sessionbar"><span className="demo-branch">⑂</span><strong>{state.session?.title || "Lattice Session"}</strong><span>fix/concurrent-join</span></div>
    <div className="demo-body">
      <nav className="demo-rail"><span>▧</span><span className="active">⌘</span><span>⑂</span><span>☷</span><span className="rail-avatar" style={{ background: mine?.color || (id === "alice" ? "#ed6798" : "#54b5f8") }}>{id === "alice" ? "AL" : "BO"}</span></nav>
      <main className="demo-main">
        <div className="demo-editor">
          {view === "live" && state.session?.documents?.length ? <LiveEditor state={{ ...state, following }} post={post}/> : <>
            <div className="demo-tabs">{["src/session_store.ts", "tests/join.test.ts"].map(path => <button key={path} className={path === file ? "active" : ""} onClick={() => { setFile(path); void post({ type: "event", event: { type: "presence", file: path, line: 5 } }); }}><span>◈</span>{path.split("/").pop()}{state.session?.people.filter(p => p.file === path).map(p => <i key={p.id} style={{ background: p.color }}>{p.name.slice(0, 1)}</i>)}</button>)}</div>
            <div className="demo-breadcrumb">{file}<span>{filePeople.map(p => p.name).join(" · ")}</span></div>
            <div className="demo-source">{code.split("\n").map((line, i) => <div key={i} className={i === 5 ? "highlight" : ""}><span>{i + 1}</span><code className={line.trim().startsWith("//") ? "comment" : ""}>{line || " "}</code></div>)}</div>
          </>}
        </div>
        <section className="demo-composer"><App state={state} mode="composer" post={post}/></section>
      </main>
      <aside className="demo-sidebar"><App state={state} mode="sidebar" post={post}/></aside>
    </div>
    <footer className="demo-status"><span>⑂ fix/concurrent-join</span><span><i/>{state.connected ? `${state.session?.people.length || 1} connected` : "Ready to connect"}</span><span>TypeScript</span></footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<DemoFrame/>);
