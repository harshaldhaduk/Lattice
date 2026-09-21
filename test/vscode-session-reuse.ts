import * as vscode from "vscode";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "../src/extension/git";
import { SessionFlow } from "../src/extension/session-flow";
import type { Controller } from "../src/extension/controller";
import { SessionClient } from "../src/shared/client";
import { startRelay } from "../src/relay/server";

export async function run() {
  const scratch = await mkdtemp(join(tmpdir(), "lattice-resume-test-"));
  const root = join(scratch, "repo"),
    origin = join(scratch, "origin.git");
  const relay = await startRelay({ port: 0 });
  const client = new SessionClient();
  try {
    await mkdir(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(root, "source.txt"), "Existing work\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Base"]);
    await git(scratch, ["init", "--bare", origin]);
    await git(root, ["remote", "add", "origin", origin]);
    await git(root, ["push", "origin", "main"]);
    const head = await git(root, ["rev-parse", "HEAD"]);
    const credentials = await client.create(
      `ws://127.0.0.1:${relay.port}`,
      "Existing feature",
      origin,
      "session/existing",
      { name: "Owner" },
      {
        baseBranch: "main",
        baseCommit: head,
        remote: origin,
        status: "active",
      },
    );
    const values = new Map<string, unknown>([
      ["sessions", [{ id: credentials.room, time: Date.now() }]],
    ]);
    const secrets = new Map([
      [`savedSession:${credentials.room}`, JSON.stringify(credentials)],
    ]);
    const before = await git(root, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
    ]);
    let opened = 0;
    const controller = {
      root,
      client,
      state: {},
      open: async () => {
        opened++;
      },
      context: {
        globalStorageUri: vscode.Uri.file(join(scratch, "storage")),
        globalState: {
          get: (k: string, fallback: unknown) => values.get(k) ?? fallback,
          update: async (k: string, v: unknown) => {
            values.set(k, v);
          },
        },
        secrets: {
          get: async (k: string) => secrets.get(k),
          store: async (k: string, v: string) => {
            secrets.set(k, v);
          },
        },
      },
    } as unknown as Controller;
    const resume = new SessionFlow(controller, async (sessions) => {
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, credentials.room);
      assert.equal(
        client.connected,
        true,
        "Lookup must not displace the live owner",
      );
      return { resume: sessions[0].id };
    });
    await resume.create("Accidental duplicate");
    assert.equal(opened, 1);
    assert.equal(
      await git(root, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
      before,
    );
    const cancel = new SessionFlow(controller, async () => undefined);
    await cancel.create("Cancelled duplicate");
    assert.equal(opened, 1);
    assert.equal(
      await git(root, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
      before,
    );
    await client.disconnect();
    let reopened: string | undefined;
    const afterClose = new SessionFlow(controller, async (sessions) => {
      assert.equal(sessions[0].id, credentials.room);
      return { resume: sessions[0].id };
    });
    afterClose.open = async (id) => {
      reopened = id;
    };
    await afterClose.create("Returning tomorrow");
    assert.equal(reopened, credentials.room);
    assert.equal(
      await git(root, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
      before,
    );
    await client.join(
      credentials.relay,
      credentials.room,
      credentials.token,
      { name: "Owner" },
      credentials.resume,
    );
    // Stop immediately after branch creation, before opening another VS Code window.
    controller.host = async (_title, path) => {
      assert.ok(path);
      assert.match(
        await git(path!, ["branch", "--show-current"]),
        /^session\/deliberate-feature-/,
      );
      throw Error("NEW_BRANCH_VERIFIED");
    };
    const create = new SessionFlow(controller, async () => "new");
    await assert.rejects(
      create.create("Deliberate feature"),
      /NEW_BRANCH_VERIFIED/,
    );
    const after = await git(root, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
    ]);
    assert.equal(after.split("\n").length, before.split("\n").length + 1);
    assert.equal(
      relay.rooms.get(credentials.room)!.session.people.filter((p) => p.online)
        .length,
      1,
    );
    console.log(
      "LATTICE_SESSION_REUSE_OK: resume and cancel preserve branch count; explicit new creates one branch; observation preserves membership",
    );
  } finally {
    client.dispose();
    await relay.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
