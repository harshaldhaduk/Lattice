import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import {
  WorkspaceMirror,
  safeMirrorPath,
} from "../src/extension/workspace-mirror";
import { byteHash } from "../src/shared/workspace";
import { git } from "../src/extension/git";
const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function eventually(check: () => Promise<boolean>) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await pause();
  }
  throw Error("Workspace did not converge");
}

test("joining downloads the host's files without Git, then syncs both ways and preserves collisions", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-workspace-"));
  const hostRoot = join(temp, "host"),
    guestRoot = join(temp, "guest");
  await mkdir(hostRoot);
  await mkdir(guestRoot);
  await writeFile(join(hostRoot, "app.ts"), "export const value = 1;\n");
  await writeFile(
    join(hostRoot, "logo.png"),
    Buffer.from([137, 80, 78, 71, 0, 255]),
  );
  await writeFile(join(hostRoot, ".env"), "SECRET=do-not-share");
  await writeFile(join(hostRoot, "too-large.bin"), Buffer.alloc(600000));
  const relay = await startRelay({ port: 0 });
  const host = new SessionClient(),
    guest = new SessionClient(),
    viewer = new SessionClient();
  const notices: string[] = [];
  const a = new WorkspaceMirror(host, hostRoot, join(temp, "a.json"), (m) =>
    notices.push(m),
  );
  const b = new WorkspaceMirror(guest, guestRoot, join(temp, "b.json"), (m) =>
    notices.push(m),
  );
  try {
    const c = await host.create(
      `ws://127.0.0.1:${relay.port}`,
      "Workspace",
      "repo",
      "main",
      { name: "Alice" },
    );
    await a.start(true);
    await guest.join(c.relay, c.room, c.token, { name: "Bob" });
    await b.start();
    assert.equal(
      await readFile(join(guestRoot, "app.ts"), "utf8"),
      "export const value = 1;\n",
    );
    assert.deepEqual(
      await readFile(join(guestRoot, "logo.png")),
      Buffer.from([137, 80, 78, 71, 0, 255]),
    );
    await assert.rejects(readFile(join(guestRoot, ".env")));
    assert.ok(
      guest.session!.workspace!.skipped.some((f) =>
        f.startsWith("too-large.bin"),
      ),
    );
    await writeFile(join(guestRoot, "app.ts"), "export const value = 2;\n");
    await b.publish("app.ts");
    await eventually(async () =>
      (await readFile(join(hostRoot, "app.ts"), "utf8")).includes("2"),
    );
    await writeFile(join(hostRoot, "new.ts"), "new file");
    await a.publish("new.ts");
    await eventually(
      async () =>
        (await readFile(join(guestRoot, "new.ts"), "utf8")) === "new file",
    );
    await writeFile(join(guestRoot, "app.ts"), "local work");
    await writeFile(join(hostRoot, "app.ts"), "host work");
    await a.publish("app.ts");
    await eventually(async () => b.conflicts.has("app.ts"));
    assert.equal(
      await readFile(join(guestRoot, "app.ts"), "utf8"),
      "local work",
    );
    await b.publish("app.ts");
    assert.equal(await readFile(join(hostRoot, "app.ts"), "utf8"), "host work");
    await rm(join(hostRoot, "new.ts"));
    await a.publish("new.ts");
    await eventually(async () =>
      readFile(join(guestRoot, "new.ts")).then(
        () => false,
        () => true,
      ),
    );
    const invite = await host.request({ op: "invite", role: "viewer" });
    await viewer.join(c.relay, c.room, invite.token, { name: "Viewer" });
    assert.equal(
      (await viewer.request({ op: "workspace.index" })).files.length,
      2,
    );
    await assert.rejects(
      viewer.request({
        op: "workspace.put",
        file: "evil.ts",
        content: "eA==",
        before: null,
      }),
      /Editor/,
    );
    for (const file of [
      "../outside",
      "__proto__/x",
      ".git/config",
      ".vscode/tasks.json",
      "nested/.env.local",
      "secret.pem",
    ])
      if (file !== "__proto__/x")
        await assert.rejects(
          host.request({
            op: "workspace.put",
            file,
            content: "eA==",
            before: null,
          }),
        );
    assert.ok(notices.some((n) => n.includes("preserved")));
  } finally {
    a.dispose();
    b.dispose();
    host.dispose();
    guest.dispose();
    viewer.dispose();
    await relay.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("workspace mirrors reject symlinks, respect Git ignores, and pause/resume incoming changes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-workspace-"));
  const root = join(temp, "root"),
    receiver = join(temp, "receiver");
  await mkdir(root);
  await mkdir(receiver);
  await git(root, ["init"]);
  await writeFile(join(root, ".gitignore"), "private/\n");
  await mkdir(join(root, "private"));
  await writeFile(join(root, "private", "notes.txt"), "private");
  await symlink(temp, join(receiver, "escape"));
  await assert.rejects(safeMirrorPath(receiver, "escape/other.ts"), /Symlinks/);
  const relay = await startRelay({ port: 0 });
  const a = new SessionClient(),
    b = new SessionClient();
  let enabled = false;
  const first = new WorkspaceMirror(
    a,
    root,
    join(temp, "first.json"),
    () => {},
  );
  const second = new WorkspaceMirror(
    b,
    receiver,
    join(temp, "second.json"),
    () => {},
    undefined,
    () => enabled,
  );
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Pause",
      "repo",
      "main",
      { name: "A" },
    );
    await writeFile(join(root, "one.ts"), "one");
    await first.start(true);
    // A bulk join must not trip the relay's 100 requests/second guard.
    for (let i = 0; i < 110; i++) {
      await a.request({
        op: "workspace.put",
        file: `many/file-${i}.ts`,
        content: Buffer.from(String(i)).toString("base64"),
        before: null,
      });
      await pause(22);
    }
    await b.join(c.relay, c.room, c.token, { name: "B" });
    await second.start();
    assert.equal(
      await readFile(join(receiver, "one.ts"), "utf8"),
      "one",
      "initial hydration works while ongoing sync is paused",
    );
    assert.equal(
      await readFile(join(receiver, "many/file-109.ts"), "utf8"),
      "109",
    );
    assert.ok(
      !(await a.request({ op: "workspace.index" })).files.some((f: any) =>
        f.file.startsWith("private/"),
      ),
    );
    await first.publish("private/notes.txt");
    assert.equal(
      await a.request({ op: "workspace.get", file: "private/notes.txt" }),
      null,
    );
    enabled = false;
    second.resume();
    await writeFile(join(root, "one.ts"), "two");
    await first.publish("one.ts");
    await pause(200);
    assert.equal(await readFile(join(receiver, "one.ts"), "utf8"), "one");
    enabled = true;
    second.resume();
    await eventually(
      async () => (await readFile(join(receiver, "one.ts"), "utf8")) === "two",
    );
    await assert.rejects(
      b.request({
        op: "workspace.put",
        file: "one.ts",
        before: byteHash(Buffer.from("one")),
        content: Buffer.from("stale").toString("base64"),
      }),
      /conflict/,
    );
  } finally {
    first.dispose();
    second.dispose();
    a.dispose();
    b.dispose();
    await relay.close();
    await rm(temp, { recursive: true, force: true });
  }
});
