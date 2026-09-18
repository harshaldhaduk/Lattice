import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import { inviteLink, parseInvite, eventSchema } from "../src/shared/protocol";
import manifest from "../package.json";
import { WebSocketServer } from "ws";
const tick = () => new Promise((r) => setTimeout(r, 30));
test("feature session creation rejects an older relay that drops branch metadata", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const request = JSON.parse(String(data));
      socket.send(
        JSON.stringify({
          type: "reply",
          requestId: request.requestId,
          result: { capabilities: ["workspace", "coordination"], session: {} },
        }),
      );
    });
  });
  const client = new SessionClient();
  try {
    const address = server.address() as { port: number };
    await assert.rejects(
      client.create(
        `ws://127.0.0.1:${address.port}`,
        "Feature",
        "repo",
        "session/feature",
        { name: "Host" },
        {
          baseBranch: "main",
          baseCommit: "a".repeat(40),
          remote: "https://github.com/example/repo.git",
          status: "active",
        },
      ),
      /relay is too old/,
    );
    assert.equal(client.credentials, undefined);
  } finally {
    client.dispose();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("a second local relay rejects a busy port without breaking the running relay", async () => {
  const relay = await startRelay({ port: 0 });
  const client = new SessionClient();
  try {
    await assert.rejects(startRelay({ port: relay.port }), {
      code: "EADDRINUSE",
    });
    const session = await client.create(
      `ws://127.0.0.1:${relay.port}`,
      "Existing relay remains available",
      "repo",
      "main",
      { name: "Host" },
    );
    assert.ok(session.room);
  } finally {
    client.dispose();
    await relay.close();
  }
});
test("session membership, permissions, collaboration, approvals, and removal", async () => {
  const relay = await startRelay({ port: 0 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const host = new SessionClient(),
    editor = new SessionClient(),
    viewer = new SessionClient(),
    invalid = new SessionClient();
  try {
    const c = await host.create(url, "Ship together", "repo", "main", {
      name: "Host",
    });
    assert.deepEqual(parseInvite(inviteLink(url, c.room, c.token)), {
      relay: url,
      room: c.room,
      token: c.token,
    });
    await assert.rejects(
      invalid.join(url, c.room, "invalid-token-value", { name: "Invalid" }),
      /invalid/,
    );
    const e = await editor.join(url, c.room, c.token, { name: "Editor" });
    const v = await host.request({ op: "invite", role: "viewer" });
    await viewer.join(url, c.room, v.token, { name: "Viewer" });
    await assert.rejects(
      viewer.event({ type: "plan.add", text: "No" }),
      /read-only/,
    );
    await assert.rejects(
      editor.request({ op: "invite", role: "editor" }),
      /owner/,
    );
    await editor.event({
      type: "presence",
      file: "src/index.ts",
      line: 7,
      column: 23,
    });
    await tick();
    assert.equal(
      host.session!.people.find((p) => p.id === e.personId)!.file,
      "src/index.ts",
    );
    assert.equal(
      host.session!.people.find((p) => p.id === e.personId)!.column,
      23,
    );
    await assert.rejects(
      editor.request({ op: "event", event: { type: "presence", column: -1 } }),
      /Invalid/,
    );
    // An older client can omit columns without retaining a stale position.
    await editor.event({ type: "presence", file: "src/index.ts", line: 8 });
    await tick();
    assert.equal(
      host.session!.people.find((p) => p.id === e.personId)!.column,
      undefined,
    );
    await assert.rejects(
      editor.request({
        op: "event",
        event: { type: "presence", file: "../secret" },
      }),
      /Invalid/,
    );
    await editor.event({
      type: "entry",
      entryId: "entry",
      kind: "agent",
      text: "hello ",
    });
    await editor.event({
      type: "entry",
      entryId: "entry",
      kind: "agent",
      text: "world",
      append: true,
    });
    await tick();
    assert.equal(
      host.session!.entries.find((x) => x.id === "entry")!.text,
      "hello world",
    );
    await assert.rejects(
      host.event({
        type: "entry",
        entryId: "entry",
        kind: "agent",
        text: "spoof",
      }),
      /another participant/,
    );
    await editor.event({ type: "plan.add", text: "Write tests" });
    await tick();
    const step = host.session!.plan[0];
    assert.equal(step.owner, e.personId);
    await host.event({ type: "plan.update", id: step.id, done: true });
    await editor.event({
      type: "note.add",
      kind: "comments",
      file: "src/index.ts",
      line: 7,
      text: "Watch the race",
    });
    await editor.event({
      type: "note.add",
      kind: "memories",
      text: "Use monotonic revisions",
    });
    await assert.rejects(
      editor.event({
        type: "approval.add",
        id: "bad",
        runId: "not-running",
        title: "bad",
        detail: "",
      }),
      /current run/,
    );
    await editor.event({
      type: "agent",
      provider: "codex",
      status: "running",
      task: "Fix",
      detail: "Working",
      runId: "run",
    });
    await host.event({
      type: "guidance.send",
      to: e.personId,
      runId: "run",
      action: "steer",
      text: "Check the retry path",
    });
    await tick();
    const guidance = editor.session!.guidance![0];
    await assert.rejects(
      viewer.event({
        type: "guidance.send",
        to: e.personId,
        runId: "run",
        action: "stop",
        text: "",
      }),
      /read-only/,
    );
    await assert.rejects(
      host.event({
        type: "guidance.result",
        id: guidance.id,
        delivered: true,
        detail: "Spoof",
      }),
      /unavailable/,
    );
    await editor.event({
      type: "guidance.result",
      id: guidance.id,
      delivered: true,
      detail: "Delivered",
    });
    await assert.rejects(
      host.event({
        type: "guidance.send",
        to: e.personId,
        runId: "old-run",
        action: "stop",
        text: "",
      }),
      /no longer running/,
    );
    await editor.event({
      type: "approval.add",
      id: "approval",
      runId: "run",
      title: "Write files",
      detail: "src/index.ts",
    });
    await assert.rejects(
      viewer.event({ type: "approval.decide", id: "approval", approve: true }),
      /read-only/,
    );
    const decisions = await Promise.allSettled([
      host.event({ type: "approval.decide", id: "approval", approve: true }),
      editor.event({ type: "approval.decide", id: "approval", approve: false }),
    ]);
    assert.equal(decisions.filter((x) => x.status === "fulfilled").length, 1);
    await host.event({
      type: "handoff.add",
      to: e.personId,
      task: "Take over tests",
    });
    await tick();
    const handoff = editor.session!.handoffs[0];
    await assert.rejects(
      host.event({ type: "handoff.decide", id: handoff.id, accept: true }),
      /unavailable/,
    );
    await editor.event({
      type: "handoff.decide",
      id: handoff.id,
      accept: true,
    });
    await editor.event({ type: "usage", input: 123, output: 45, cost: 0.01 });
    await tick();
    assert.equal(
      host.session!.people.find((p) => p.id === e.personId)!.usage.input,
      123,
    );
    await host.event({ type: "role", personId: e.personId, role: "viewer" });
    await assert.rejects(
      editor.event({ type: "entry", kind: "message", text: "forbidden" }),
      /read-only/,
    );
    await host.event({ type: "remove", personId: e.personId });
    await tick();
    assert.equal(editor.credentials, undefined);
    await assert.rejects(
      invalid.join(url, c.room, c.token, { name: "Return" }, e.resume),
      /Membership expired/,
    );
  } finally {
    for (const c of [host, editor, viewer, invalid]) c.dispose();
    await relay.close();
  }
});
test("resuming preserves identity and old sockets cannot overwrite a new connection", async () => {
  const relay = await startRelay({ port: 0 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const a = new SessionClient(),
    b = new SessionClient();
  try {
    const c = await a.create(url, "Session", "repo", "main", { name: "A" });
    await b.join(url, c.room, c.token, { name: "A" }, c.resume);
    await tick();
    assert.equal(a.credentials, undefined);
    assert.equal(b.session!.people.length, 1);
    assert.equal(b.credentials!.personId, c.personId);
    await b.disconnect();
    await b.create(url, "Second session", "repo", "main", { name: "B" });
    await tick();
    assert.equal(b.connected, true);
    assert.equal(b.session!.title, "Second session");
    await b.event({ type: "plan.add", text: "Still connected" });
  } finally {
    a.dispose();
    b.dispose();
    await relay.close();
  }
});
test("relay restart restores shared state and denies abandoned approvals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lattice-persist-"));
  let relay = await startRelay({ port: 0, dataDir: dir });
  const a = new SessionClient();
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Persist",
      "repo",
      "main",
      { name: "A" },
    );
    await a.event({
      type: "note.add",
      kind: "memories",
      text: "Architecture decision",
    });
    await a.event({
      type: "agent",
      provider: "claude",
      runId: "r",
      status: "running",
      task: "Task",
      detail: "",
    });
    await a.event({
      type: "approval.add",
      id: "a",
      runId: "r",
      title: "Write",
      detail: "",
    });
    a.dispose();
    await relay.close();
    const stored = await readFile(join(dir, "sessions.json"), "utf8");
    assert.ok(!stored.includes(c.token));
    assert.ok(!stored.includes(c.resume));
    relay = await startRelay({ port: 0, dataDir: dir });
    const b = new SessionClient();
    try {
      await b.join(
        `ws://127.0.0.1:${relay.port}`,
        c.room,
        c.token,
        { name: "A" },
        c.resume,
      );
      assert.equal(b.session!.memories[0].text, "Architecture decision");
      assert.equal(b.session!.approvals[0].status, "denied");
      assert.equal(b.session!.people[0].agent!.status, "stopped");
    } finally {
      b.dispose();
    }
  } finally {
    a.dispose();
    await relay.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("invitations target the installed publisher and accept normalized authority casing", () => {
  const expected = {
    relay: "wss://relay.example.com",
    room: "room with spaces",
    token: "token-with-encoded+characters&123",
  };
  const link = inviteLink(expected.relay, expected.room, expected.token);
  const uri = new URL(link);
  assert.equal(uri.hostname, `${manifest.publisher}.${manifest.name}`);
  assert.deepEqual(parseInvite(link), expected);
  uri.hostname = uri.hostname.toLowerCase();
  assert.deepEqual(parseInvite(uri.href), expected);
  uri.hostname = "another-publisher.lattice";
  assert.throws(() => parseInvite(uri.href), /invite link/);
});
test("path and invite parsing rejects unsafe input", () => {
  for (const file of ["/etc/passwd", "../x", "src/../../x", "C:\\x", "x\0"])
    assert.equal(
      eventSchema.safeParse({ type: "presence", file }).success,
      false,
    );
  assert.throws(() => parseInvite("https://example.com"));
  assert.throws(() =>
    parseInvite(inviteLink("https://bad", "room", "token-token-token")),
  );
});
