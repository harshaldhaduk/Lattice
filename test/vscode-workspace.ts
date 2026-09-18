import * as vscode from "vscode";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionWorkspace } from "../src/extension/session-workspace";
import { LiveTeamContext } from "../src/extension/coordination";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually(check: () => Promise<boolean>) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await pause(50);
  }
  throw Error("Native workspace did not converge");
}
export async function run() {
  const scratch = await mkdtemp(join(tmpdir(), "lattice-native-workspace-"));
  const hostRoot = join(scratch, "host");
  await mkdir(hostRoot);
  await writeFile(join(hostRoot, "app.ts"), "export const value = 1;\n");
  await writeFile(join(hostRoot, "package.json"), '{"name":"fixture"}\n');
  const relay = await startRelay({ port: 0 });
  const a = new SessionClient(),
    b = new SessionClient();
  const secrets = new Map<string, string>();
  const context = {
    globalStorageUri: vscode.Uri.file(join(scratch, "storage")),
    secrets: {
      store: async (k: string, v: string) => {
        secrets.set(k, v);
      },
    },
    globalState: { update: async () => {} },
  } as unknown as vscode.ExtensionContext;
  const notices: string[] = [];
  const host = new SessionWorkspace(
    a,
    context,
    () => {},
    (text) => notices.push(text),
  );
  const guest = new SessionWorkspace(
    b,
    context,
    () => {},
    (text) => notices.push(text),
  );
  let team: LiveTeamContext | undefined;
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Native workspace",
      "repo",
      "main",
      { name: "Alice" },
    );
    await host.start(hostRoot, true);
    await b.join(c.relay, c.room, c.token, { name: "Bob" });
    const guestRoot = await guest.prepareJoined();
    assert.equal(
      await readFile(join(guestRoot, "app.ts"), "utf8"),
      "export const value = 1;\n",
    );
    assert.ok(
      secrets.has("session:" + vscode.Uri.file(guestRoot).toString()),
      "New window has resume credentials before opening",
    );
    assert.ok(
      await readFile(join(guestRoot, ".git", "HEAD"), "utf8"),
      "Managed snapshot supports task worktrees without cloning",
    );
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(await realpath(join(guestRoot, "app.ts"))),
    );
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((edit) =>
      edit.insert(new vscode.Position(0, 0), "// Bob typing\n"),
    );
    await eventually(async () =>
      (await readFile(join(hostRoot, "app.ts"), "utf8")).includes("Bob typing"),
    );
    assert.ok(
      doc.isDirty,
      "Guest typing remains a normal unsaved VS Code buffer",
    );
    await writeFile(join(hostRoot, "new.ts"), "export const live = true;\n");
    await eventually(async () =>
      (await readFile(join(guestRoot, "new.ts"), "utf8")).includes("live"),
    );
    team = new LiveTeamContext(b, guestRoot, "fixture");
    await team.start();
    await a.event({ type: "plan.add", text: "Alice owns validation" });
    await eventually(async () =>
      (await readFile(team!.file, "utf8")).includes("Alice owns validation"),
    );
    await a.request({
      op: "intent.claim",
      id: "alice-work",
      prompt: "Implement schema validation",
      files: ["schema.ts"],
      readOnly: false,
      sensitivity: 6,
    });
    await eventually(async () =>
      (await readFile(team!.file, "utf8")).includes("alice-work"),
    );
    await b.request({ op: "workspace.index" });
    assert.equal(
      await b.request({
        op: "workspace.get",
        file: ".lattice/session-context.json",
      }),
      null,
    );
    const result = {
      passed: true,
      checks: [
        "managed workspace prepared without clone",
        "resume credentials stored for new window",
        "snapshot Git initialized",
        "unsaved native typing shared to host",
        "host file creation reaches guest",
        "team context refreshes during active work",
        "runtime context excluded from sharing",
      ],
      notices,
    };
    await mkdir(
      join(vscode.workspace.workspaceFolders![0].uri.fsPath, "artifacts"),
      { recursive: true },
    );
    await writeFile(
      join(
        vscode.workspace.workspaceFolders![0].uri.fsPath,
        "artifacts/vscode-workspace-test.json",
      ),
      JSON.stringify(result, null, 2),
    );
    console.log("LATTICE_WORKSPACE_OK " + JSON.stringify(result));
  } finally {
    team?.dispose();
    host.dispose();
    guest.dispose();
    a.dispose();
    b.dispose();
    await relay.close();
    await pause(150);
    await rm(scratch, { recursive: true, force: true });
  }
}
