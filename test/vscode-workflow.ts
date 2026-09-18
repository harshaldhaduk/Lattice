import * as vscode from "vscode";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "../src/extension/git";
import { createBranchSession } from "../src/extension/branch-workflow";
import { SessionWorkspace } from "../src/extension/session-workspace";
import { reserveWork } from "../src/extension/coordination";
import { SessionClient } from "../src/shared/client";
import { startRelay } from "../src/relay/server";
export async function run() {
  const scratch = await mkdtemp(join(tmpdir(), "lattice-native-flow-"));
  const root = join(scratch, "repo"),
    origin = join(scratch, "origin.git"),
    remote = "https://github.com/lattice-fixture/workflow.git";
  const previous = Object.fromEntries(
    ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"].map((k) => [
      k,
      process.env[k],
    ]),
  );
  const relay = await startRelay({ port: 0 });
  const a = new SessionClient(),
    b = new SessionClient();
  const secrets = new Map<string, string>(),
    values = new Map<string, unknown>();
  const context = {
    globalStorageUri: vscode.Uri.file(join(scratch, "storage")),
    secrets: {
      store: async (k: string, v: string) => {
        secrets.set(k, v);
      },
    },
    globalState: {
      update: async (k: string, v: unknown) => {
        values.set(k, v);
      },
    },
  } as unknown as vscode.ExtensionContext;
  const host = new SessionWorkspace(
      a,
      context,
      () => {},
      () => {},
    ),
    guest = new SessionWorkspace(
      b,
      context,
      () => {},
      () => {},
    );
  try {
    await mkdir(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(root, "app.ts"), "export const base = true;\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Base"]);
    await git(scratch, ["init", "--bare", origin]);
    await git(root, ["remote", "add", "origin", origin]);
    await git(root, ["push", "origin", "main"]);
    const feature = await createBranchSession(
      root,
      join(scratch, "sessions"),
      "Live branch",
    );
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = `url.${origin}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = remote;
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Live branch",
      remote,
      feature.branch,
      { name: "Host" },
      { ...feature.lifecycle, remote },
    );
    await writeFile(
      join(feature.path, "app.ts"),
      "export const live = true;\n",
    );
    await host.start(feature.path, true);
    await b.join(c.relay, c.room, c.token, { name: "Guest" });
    const managed = await guest.prepareJoined();
    assert.equal(
      await git(managed, ["rev-parse", "HEAD"]),
      feature.lifecycle.baseCommit,
    );
    assert.equal(
      await git(managed, ["branch", "--show-current"]),
      feature.branch,
    );
    assert.equal(
      await readFile(join(managed, "app.ts"), "utf8"),
      "export const live = true;\n",
    );
    assert.equal(
      await readFile(join(root, "app.ts"), "utf8"),
      "export const base = true;\n",
    );
    assert.ok(secrets.has("session:" + vscode.Uri.file(managed).toString()));
    await a.request({
      op: "intent.claim",
      id: "owner-work",
      prompt: "Edit app.ts",
      files: ["app.ts"],
      readOnly: false,
      sensitivity: 6,
    });
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
    }, 50);
    await assert.rejects(
      reserveWork(
        b,
        "queued",
        "Edit app.ts",
        false,
        "app.ts",
        6,
        async () => {},
        () => cancelled,
      ),
      /stopped/,
    );
    clearTimeout(timer);
    assert.ok(
      !relay.rooms.get(c.room)!.session.intents?.some((i) => i.id === "queued"),
    );
    console.log(
      "LATTICE_BRANCH_WORKFLOW_OK " +
        JSON.stringify({
          passed: true,
          checks: [
            "guest clone prepared without manual checkout",
            "shared Git base and session branch preserved",
            "uncommitted live work hydrated",
            "original main checkout preserved",
            "window credentials prepared",
            "overlapping queued prompt can be stopped",
          ],
          externalGitHub: false,
          paidInference: false,
        }),
    );
  } finally {
    host.dispose();
    guest.dispose();
    a.dispose();
    b.dispose();
    await relay.close();
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(scratch, { recursive: true, force: true });
  }
}
