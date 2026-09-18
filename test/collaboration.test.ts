import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createCipheriv } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { textUpdate, mergeText } from "../src/shared/collaboration";
import { contentHash } from "../src/shared/files";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import { SessionStore } from "../src/relay/storage";

test("character operations converge regardless of order, including overlapping edits and Unicode", () => {
  for (const [base, left, right] of [
    ["alpha\nbeta\n", "first\nbeta\n", "alpha\nsecond\n"],
    ["abc", "aXbc", "aYbc"],
    ["hello 🌍", "hello 🌍!", "Hello 🌍"],
    ["abcdef", "abef", "abc!def"],
  ]) {
    const a = textUpdate(base, left),
      b = textUpdate(base, right);
    const ab = mergeText(base, b.update, mergeText(base, a.update).crdtState);
    const ba = mergeText(base, a.update, mergeText(base, b.update).crdtState);
    assert.equal(ab.content, ba.content);
    assert.equal(mergeText(base, a.update, ab.crdtState).content, ab.content);
    if (base === "alpha\nbeta\n") assert.equal(ab.content, "first\nsecond\n");
  }
});
test("24 simultaneous members converge on the same collaborative source", async () => {
  const relay = await startRelay({ port: 0 });
  const clients = Array.from({ length: 24 }, () => new SessionClient());
  try {
    const c = await clients[0].create(
      `ws://127.0.0.1:${relay.port}`,
      "Concurrent team",
      "repo",
      "main",
      { name: "0" },
    );
    await Promise.all(
      clients
        .slice(1)
        .map((client, i) =>
          client.join(c.relay, c.room, c.token, { name: String(i + 1) }),
        ),
    );
    const base = "// shared\n";
    await Promise.all(
      clients.map((client, i) => {
        const content = base + `// member ${i}\n`;
        return client.event({
          type: "document.update",
          human: true,
          file: "team.ts",
          runId: "human:" + client.credentials!.personId,
          isolated: false,
          beforeHash: contentHash(base),
          baseMissing: false,
          content,
          line: 1,
          column: 0,
          collaboration: {
            base,
            baseHash: contentHash(base),
            update: textUpdate(base, content).update,
          },
        });
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    const content = relay.rooms.get(c.room)!.session.documents![0].content;
    for (let i = 0; i < 24; i++)
      assert.ok(content.includes(`// member ${i}\n`));
    assert.ok(
      clients.every(
        (client) => client.session!.documents![0].content === content,
      ),
    );
  } finally {
    clients.forEach((c) => c.dispose());
    await relay.close();
  }
});

test("relay merges two stale writers, enforces file operations, and preserves collaborative state on restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lattice-crdt-"));
  let relay = await startRelay({ port: 0, dataDir: directory });
  const a = new SessionClient(),
    b = new SessionClient();
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Together",
      "repo",
      "main",
      { name: "A" },
    );
    await b.join(c.relay, c.room, c.token, { name: "B" });
    const base = "alpha\nbeta\n";
    const event = (client: SessionClient, content: string) => ({
      type: "document.update" as const,
      human: true,
      file: "src/a.ts",
      runId: "human:" + client.credentials!.personId,
      isolated: false,
      beforeHash: contentHash(base),
      baseMissing: false,
      content,
      line: 0,
      column: 0,
      collaboration: {
        base,
        baseHash: contentHash(base),
        update: textUpdate(base, content).update,
      },
    });
    await Promise.all([
      a.event(event(a, "first\nbeta\n")),
      b.event(event(b, "alpha\nsecond\n")),
    ]);
    const session = relay.rooms.get(c.room)!.session;
    assert.equal(session.documents![0].content, "first\nsecond\n");
    await assert.rejects(
      a.event({
        type: "document.operation",
        id: "stale",
        file: "src/a.ts",
        target: "src/b.ts",
        beforeHash: contentHash(base),
      }),
      /changed/,
    );
    await a.event({
      type: "document.operation",
      id: "rename",
      file: "src/a.ts",
      target: "src/b.ts",
      beforeHash: session.documents![0].hash,
    });
    assert.equal(session.documents![0].file, "src/b.ts");
    assert.equal(session.operations!.length, 1);
    a.dispose();
    b.dispose();
    await relay.close();
    relay = await startRelay({ port: 0, dataDir: directory });
    assert.equal(
      relay.rooms.get(c.room)!.session.documents![0].content,
      "first\nsecond\n",
    );
    assert.ok(relay.rooms.get(c.room)!.session.documents![0].crdtState);
  } finally {
    a.dispose();
    b.dispose();
    await relay.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted storage rejects tampering and wrong keys without writing plaintext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lattice-encrypted-"));
  try {
    const store = new SessionStore(directory, "11".repeat(32));
    store.write([{ secret: "private team source" }]);
    assert.ok(
      !(await readFile(join(directory, "sessions.json"), "utf8")).includes(
        "private team source",
      ),
    );
    assert.deepEqual(store.read(), [{ secret: "private team source" }]);
    assert.throws(() => new SessionStore(directory, "22".repeat(32)).read());
    assert.throws(
      () => new SessionStore(directory).read(),
      /original storage key/,
    );
    store.write([{ secret: "updated source" }]);
    assert.ok(
      !(
        await readFile(join(directory, "sessions.json.backup"), "utf8")
      ).includes("private team source"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted snapshots retain authenticated compatibility after a product rename", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lattice-storage-upgrade-"));
  try {
    const key = "11".repeat(32);
    const format = "previous-product-aes256gcm-v1";
    const iv = Buffer.alloc(12, 7);
    const rooms = [{ id: "saved-session", entries: ["preserved history"] }];
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    cipher.setAAD(Buffer.from(format));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(rooms)),
      cipher.final(),
    ]);
    const file = join(directory, "sessions.json");
    const envelope = {
      format,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    await writeFile(file, JSON.stringify(envelope));
    const store = new SessionStore(directory, key);
    assert.deepEqual(store.read(), rooms);
    await writeFile(
      file,
      JSON.stringify({ ...envelope, format: "different-product-aes256gcm-v1" }),
    );
    assert.throws(() => store.read());
    await writeFile(file, JSON.stringify(envelope));
    store.write(store.read());
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).format,
      "lattice-aes256gcm-v1",
    );
    assert.deepEqual(store.read(), rooms);
    assert.equal(
      JSON.parse(await readFile(file + ".backup", "utf8")).format,
      format,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invitations expire, run out, and revoke independently from established memberships", async () => {
  const relay = await startRelay({ port: 0 });
  const owner = new SessionClient(),
    peer = new SessionClient(),
    next = new SessionClient();
  try {
    const c = await owner.create(
      `ws://127.0.0.1:${relay.port}`,
      "Invites",
      "repo",
      "main",
      { name: "Owner" },
    );
    const invite = await owner.request({
      op: "invite",
      role: "editor",
      maxUses: 1,
      expiresIn: 60,
    });
    const membership = await peer.join(c.relay, c.room, invite.token, {
      name: "Peer",
    });
    await assert.rejects(
      next.join(c.relay, c.room, invite.token, { name: "Next" }),
      /expired/,
    );
    await owner.request({ op: "revokeInvite", inviteId: invite.id });
    await peer.disconnect();
    await peer.join(
      c.relay,
      c.room,
      invite.token,
      { name: "Peer" },
      membership.resume,
    );
    const expiry = await owner.request({
      op: "invite",
      role: "viewer",
      expiresIn: 60,
    });
    const stored = Object.values(relay.rooms.get(c.room)!.invites).find(
      (i) => i.id === expiry.id,
    )!;
    stored.expires = Date.now() - 1;
    await assert.rejects(
      next.join(c.relay, c.room, expiry.token, { name: "Next" }),
      /expired/,
    );
    await assert.rejects(peer.request({ op: "invites" }), /owner/);
  } finally {
    owner.dispose();
    peer.dispose();
    next.dispose();
    await relay.close();
  }
});

test("verified membership cannot be resumed by another account", async () => {
  const relay = await startRelay({
    port: 0,
    requireIdentity: true,
    verifyIdentity: async (token) => {
      if (!token) throw Error("No identity");
      return { id: token, login: token, provider: "github" };
    },
  });
  const a = new SessionClient(),
    b = new SessionClient();
  a.authorization = async () => "alice";
  b.authorization = async () => "bob";
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Identity",
      "repo",
      "main",
      { name: "A" },
    );
    assert.equal(a.session!.people[0].identity!.login, "alice");
    await assert.rejects(
      b.join(c.relay, c.room, c.token, { name: "B" }, c.resume),
      /different GitHub/,
    );
  } finally {
    a.dispose();
    b.dispose();
    await relay.close();
  }
});
test("indexed cross-session memory searches enforce verified membership", async () => {
  const relay = await startRelay({
    port: 0,
    requireIdentity: true,
    verifyIdentity: async (token) => ({
      id: token,
      login: token,
      provider: "github",
    }),
  });
  const privateRoom = new SessionClient(),
    sharedRoom = new SessionClient(),
    guest = new SessionClient();
  privateRoom.authorization = sharedRoom.authorization = async () => "alice";
  guest.authorization = async () => "bob";
  try {
    const url = `ws://127.0.0.1:${relay.port}`;
    await privateRoom.create(url, "Private", "repo", "main", { name: "Alice" });
    await privateRoom.event({
      type: "note.add",
      kind: "memories",
      text: "private zebra decision",
      file: "secret.ts",
    });
    const room = await sharedRoom.create(url, "Shared", "repo", "main", {
      name: "Alice",
    });
    await sharedRoom.event({
      type: "note.add",
      kind: "memories",
      text: "shared zebra decision",
      file: "public.ts",
    });
    await guest.join(url, room.room, room.token, { name: "Bob" });
    const query = {
      op: "search",
      query: "zebra",
      kind: "memory",
      scope: "memberships",
    };
    assert.equal((await sharedRoom.request(query)).length, 2);
    const visible = await guest.request(query);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].sessionTitle, "Shared");
    await sharedRoom.event({
      type: "note.resolve",
      kind: "memories",
      id: visible[0].id,
    });
    assert.equal((await guest.request(query)).length, 0);
  } finally {
    privateRoom.dispose();
    sharedRoom.dispose();
    guest.dispose();
    await relay.close();
  }
});

test("parallel usage is idempotent, searchable, budgeted, and archived with owner controls", async () => {
  const relay = await startRelay({ port: 0 });
  const a = new SessionClient(),
    b = new SessionClient();
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Tasks",
      "repo",
      "main",
      { name: "A" },
    );
    await b.join(c.relay, c.room, c.token, { name: "B" });
    const task = (runId: string) => ({
      type: "agent" as const,
      provider: "codex" as const,
      runId,
      status: "running" as const,
      task: "Build",
      detail: "",
      isolated: true,
    });
    await a.event(task("one"));
    await a.event(task("two"));
    await a.event({
      type: "usage",
      runId: "one",
      provider: "codex",
      input: 100,
      output: 10,
    });
    await a.event({
      type: "usage",
      runId: "two",
      provider: "codex",
      input: 200,
      output: 20,
    });
    await a.event({
      type: "usage",
      runId: "one",
      provider: "codex",
      input: 100,
      output: 10,
    });
    assert.equal(relay.rooms.get(c.room)!.session.people[0].usage.input, 300);
    await a.event({ type: "session.budget", tokens: 300 });
    await assert.rejects(a.event(task("three")), /budget/);
    await a.event({
      type: "note.add",
      kind: "memories",
      text: "Use optimistic transactions",
      file: "src/db.ts",
    });
    const results = await a.request({
      op: "search",
      query: "optimistic",
      kind: "memory",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].file, "src/db.ts");
    await assert.rejects(
      b.event({ type: "session.archive", archived: true }),
      /owner/,
    );
    await a.event({ ...task("one"), status: "done" });
    await a.event({ ...task("two"), status: "done" });
    await a.event({ type: "session.archive", archived: true });
    await assert.rejects(
      b.event({ type: "entry", kind: "message", text: "later" }),
      /archived/,
    );
    const exported = await a.request({ op: "export" });
    assert.equal(exported.tasks.length, 2);
    assert.equal(exported.usageRecords.length, 2);
    assert.ok(!JSON.stringify(exported).includes(c.resume));
  } finally {
    a.dispose();
    b.dispose();
    await relay.close();
  }
});
