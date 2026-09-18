import { colors, type AppState, type Person } from "../shared/protocol";
const now = Date.now();
const person = (
  id: string,
  name: string,
  i: number,
  file?: string,
  task?: string,
  provider: "codex" | "claude" = "codex",
): Person => ({
  id,
  name,
  color: colors[i],
  role: i === 0 ? "owner" : "editor",
  online: true,
  file,
  line: i === 1 ? 7 : 12,
  usage: {
    input: 10400 + i * 4100,
    output: 1200 + i * 270,
    cost: i === 2 ? 0.046 : undefined,
  },
  agent: task
    ? {
        provider,
        status: i === 3 ? "approval" : "running",
        task,
        detail:
          i === 3
            ? "Waiting for your review"
            : i === 2
              ? "Running the concurrent-join tests"
              : "Reading workspace context",
        runId: id + "-run",
      }
    : undefined,
});
let state: AppState = {
  preview: true,
  liveSync: true,
  me: "alice",
  connected: true,
  repo: "northlight/abyssal-drift-server",
  branch: "session/lobby-join-race",
  file: "src/net/session_store.ts",
  providers: [
    { id: "codex", available: true, version: "Preview" },
    { id: "claude", available: true, version: "Preview" },
  ],
  session: {
    id: "preview",
    title: "Fix the lobby join race",
    repo: "northlight/abyssal-drift-server",
    branch: "session/lobby-join-race",
    created: now,
    revision: 1,
    people: [
      person("alice", "Alice", 0, "src/lobby/matchmaker.ts"),
      person(
        "bob",
        "Bob",
        1,
        "src/net/session_store.ts",
        "Make the seat write compare-and-set on lobby.revision.",
      ),
      person(
        "chen",
        "Chen",
        2,
        "tests/lobby/join.test.ts",
        "Cover the concurrent-join and expired-ticket paths.",
        "claude",
      ),
      person(
        "mina",
        "Mina",
        3,
        "src/lobby/join.ts",
        "Tighten the ticket expiry comparison for shard clock skew.",
      ),
      person("devon", "Devon", 4),
    ],
    entries: [
      {
        id: "1",
        actor: "alice",
        kind: "message",
        text: "Find the join race and outline a safe fix. Bob is handling the store; Chen owns the tests.",
        time: now - 120000,
      },
      {
        id: "2",
        actor: "alice",
        kind: "agent",
        provider: "codex",
        text: "Two joins can read the same revision before either write completes.\n\nI’ll trace the retry path in matchmaker.ts and keep the changes separate from Bob’s guarded write.",
        time: now - 110000,
      },
      {
        id: "3",
        actor: "bob",
        kind: "tool",
        text: "Reading src/net/session_store.ts",
        time: now - 90000,
      },
      {
        id: "4",
        actor: "bob",
        kind: "agent",
        provider: "codex",
        text: "Writing the guarded commit now. join.ts can retry on stale_revision with a fresh read.",
        time: now - 80000,
      },
      {
        id: "5",
        actor: "chen",
        kind: "tool",
        text: "npm test -- tests/lobby/join.test.ts\n2 tests passing",
        time: now - 60000,
      },
    ],
    plan: [
      { id: "p1", text: "Trace the two-join race", owner: "alice", done: true },
      {
        id: "p2",
        text: "Guard the slot write with a revision check",
        owner: "bob",
        done: false,
      },
      {
        id: "p3",
        text: "Add a concurrent-join regression test",
        owner: "chen",
        done: false,
      },
    ],
    comments: [
      {
        id: "n1",
        author: "chen",
        file: "src/lobby/join.ts",
        line: 12,
        text: "Keep the retry bounded; clients should get a fresh lobby revision.",
        resolved: false,
        time: now - 40000,
      },
    ],
    memories: [
      {
        id: "m1",
        author: "alice",
        text: "Lobby revisions are monotonic. Retry stale writes at most twice.",
        resolved: false,
        time: now - 30000,
      },
    ],
    approvals: [],
    handoffs: [],
  },
};
window.LATTICE_MODE = "preview";
window.LATTICE_PREVIEW = state;
const emit = () => {
  state = {
    ...state,
    session: state.session ? { ...state.session } : undefined,
  };
  window.postMessage({ type: "state", state }, location.origin);
};
const notice = (text: string) => {
  state.error = text;
  emit();
};
window.addEventListener("previewAction", ((e: CustomEvent) => {
  const m = e.detail;
  const s = state.session;
  const id = crypto.randomUUID();
  switch (m.type) {
    case "toggleLiveSync":
      state.liveSync = !state.liveSync;
      break;
    case "returnPreview":
      window.LATTICE_MODE = "preview";
      break;
    case "followAgent": {
      if (!s) return;
      state.following = m.id;
      window.LATTICE_MODE = "live";
      const person = s.people.find((p) => p.id === m.id);
      if (!person) return;
      const file = person.file || "src/net/session_store.ts";
      const key = "main:" + file;
      const lines = [
        "export async function reserveSlot(req: ReserveRequest) {",
        "  const result = await db.lobbies.updateOne(",
        "    { id: req.lobbyId, revision: req.expectedRevision },",
        '    { $set: { ["slots." + req.slot]: req.playerId },',
        "      $inc: { revision: 1 } },",
        "  );",
        "",
        "  if (result.matchedCount === 0) {",
        '    return { ok: false, reason: "stale_revision" };',
        "  }",
        "",
        "  return { ok: true };",
        "}",
      ];
      let step = 2;
      const document = {
        key,
        isolated: false,
        file,
        author: m.id,
        runId: person.agent?.runId || "preview-run",
        provider: person.agent?.provider || ("codex" as const),
        content: lines.slice(0, step).join("\n"),
        hash: "preview",
        baseHash: "preview",
        previousHash: "preview",
        baseMissing: false,
        version: 1,
        line: step - 1,
        column: lines[step - 1].length,
        updated: Date.now(),
      };
      s.documents = [document];
      const animation = setInterval(() => {
        if (window.LATTICE_MODE !== "live" || step >= lines.length) {
          clearInterval(animation);
          return;
        }
        step++;
        document.content = lines.slice(0, step).join("\n");
        document.line = step - 1;
        document.column = lines[step - 1].length;
        document.version++;
        document.updated = Date.now();
        emit();
      }, 650);
      break;
    }
    case "ready":
      return;
    case "clearError":
      state.error = undefined;
      break;
    case "previewFile":
      state.file = m.file;
      if (s) s.people[0].file = m.file;
      break;
    case "host":
      state.conflictSensitivity = m.sensitivity || 6;
      state.session = {
        id,
        title: m.title,
        repo: state.repo,
        branch: state.branch,
        created: Date.now(),
        revision: 0,
        people: [person("alice", "Alice", 0)],
        entries: [],
        plan: [],
        comments: [],
        memories: [],
        approvals: [],
        handoffs: [],
      };
      state.connected = true;
      break;
    case "sensitivity":
      state.conflictSensitivity = Number(m.value);
      state.onboarding = false;
      break;
    case "leave":
      state.session = undefined;
      state.connected = false;
      break;
    case "join":
      notice(
        "Preview only. Paste invitations in the installed VS Code extension to join a live session.",
      );
      return;
    case "invite":
      notice(
        "Preview only. The installed extension creates real session invitations.",
      );
      return;
    case "providers":
    case "refreshProviders":
      notice(
        "Preview providers use sample data. Open Lattice Sync in VS Code to use your installed Codex or Claude account.",
      );
      return;
    case "settings":
    case "profile":
      notice(
        "Profile and connection settings are available in the installed VS Code extension.",
      );
      return;
    case "openFile":
      state.file = m.file;
      notice(`Selected ${m.file}. In VS Code this opens your local file.`);
      return;
    case "sessionTools":
    case "collaborate":
    case "searchMemory":
    case "history":
    case "handoffTask":
    case "checkTree":
      notice(
        "This command opens native VS Code controls in the installed extension.",
      );
      return;
    case "receiveHandoff": {
      const handoff = s?.handoffs.find((h) => h.id === m.id);
      if (handoff) {
        handoff.status = "accepted";
        window.postMessage(
          { type: "draft", text: handoff.task },
          location.origin,
        );
      }
      break;
    }
    case "selectLane":
      window.postMessage({ type: "selectLane", id: m.id }, location.origin);
      break;
    case "draft":
      window.postMessage({ type: "draft", text: m.text }, location.origin);
      break;
    case "run":
      if (!s) return;
      s.entries.push({
        id,
        actor: "alice",
        kind: "message",
        text: m.prompt,
        time: Date.now(),
        provider: m.provider,
      });
      s.entries.push({
        id: id + "-answer",
        actor: "alice",
        kind: "agent",
        text:
          "This is an interactive UI preview. In the installed extension, this prompt runs through your local " +
          m.provider +
          " account and streams its response here.",
        time: Date.now(),
        provider: m.provider,
      });
      break;
    case "event":
      if (!s) return;
      const v = m.event;
      switch (v.type) {
        case "guidance.send":
          notice(
            "Preview only. In VS Code, this reaches the selected teammate’s active agent.",
          );
          return;
        case "entry":
          s.entries.push({
            id,
            actor: "alice",
            kind: v.kind,
            text: v.text,
            time: Date.now(),
          });
          break;
        case "plan.add":
          s.plan.push({ id, text: v.text, done: false, owner: "alice" });
          break;
        case "plan.update": {
          const p = s.plan.find((p) => p.id === v.id);
          if (p) p.done = v.done;
          break;
        }
        case "note.add":
          s[v.kind as "comments" | "memories"].push({
            id,
            text: v.text,
            author: "alice",
            file: v.file,
            resolved: false,
            time: Date.now(),
          });
          break;
        case "note.resolve": {
          const n = s[v.kind as "comments" | "memories"].find(
            (n) => n.id === v.id,
          );
          if (n) n.resolved = !n.resolved;
          break;
        }
        case "role": {
          const p = s.people.find((p) => p.id === v.personId);
          if (p) p.role = v.role;
          break;
        }
        case "handoff.add":
          s.handoffs.push({
            id,
            from: "alice",
            to: v.to,
            task: v.task,
            status: "pending",
          });
          break;
        case "handoff.decide": {
          const h = s.handoffs.find((h) => h.id === v.id);
          if (h) h.status = v.accept ? "accepted" : "declined";
          break;
        }
      }
      break;
  }
  emit();
}) as EventListener);
