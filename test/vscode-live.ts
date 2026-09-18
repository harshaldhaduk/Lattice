import * as vscode from "vscode";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/extension/git";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import { LiveSync } from "../src/extension/live-sync";
import { SharedEditor } from "../src/extension/shared-editor";
import { findOpenFileDocument } from "../src/extension/documents";
import { FileLifecycle } from "../src/extension/file-lifecycle";
import { TaskExecutor } from "../src/extension/task-executor";
import type { TaskTree } from "../src/extension/git";
import type { AppState } from "../src/shared/protocol";
async function eventually(check: () => Promise<boolean>, message: string) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error(message);
}
async function replace(doc: vscode.TextDocument, text: string) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    doc.uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    text,
  );
  assert.ok(await vscode.workspace.applyEdit(edit));
}
export async function run() {
  const scratch = await mkdtemp(join(tmpdir(), "lattice-live-vscode-"));
  const source = join(scratch, "source"),
    target = join(scratch, "target");
  await mkdir(source);
  await mkdir(target);
  const relay = await startRelay({ port: 0 });
  const a = new SessionClient(),
    b = new SessionClient();
  let sender: LiveSync | undefined, receiver: LiveSync | undefined;
  try {
    for (const folder of [source, target]) {
      await git(folder, ["init", "-b", "main"]);
      await git(folder, ["config", "user.email", "test@example.invalid"]);
      await git(folder, ["config", "user.name", "Test"]);
      await writeFile(join(folder, "app.ts"), "const answer = 1;\n");
      await git(folder, ["add", "."]);
      await git(folder, ["commit", "-m", "Base"]);
    }
    const credentials = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Live integration test",
      "repo",
      "main",
      { name: "Source test agent" },
    );
    await b.join(credentials.relay, credentials.room, credentials.token, {
      name: "Receiver test participant",
    });
    const state = (client: SessionClient): AppState => ({
      me: client.credentials!.personId,
      connected: client.connected,
      session: client.session,
      providers: [],
      repo: "repo",
      branch: "main",
    });
    sender = new LiveSync(
      a,
      () => source,
      () => state(a),
      () => {},
    );
    receiver = new LiveSync(
      b,
      () => target,
      () => state(b),
      () => {},
    );
    b.on("state", () => receiver?.onState());
    a.on("state", () => sender?.onState());
    await a.event({
      type: "agent",
      provider: "codex",
      runId: "live-test",
      status: "running",
      task: "Integration fixture edits",
      detail: "No model inference",
    });
    await sender.begin(source, "live-test", false);
    const sourceDoc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(join(source, "app.ts")),
    );
    await replace(sourceDoc, "const answer = 2;\n");
    await sourceDoc.save();
    await eventually(
      async () =>
        (await readFile(join(target, "app.ts"), "utf8")) ===
        "const answer = 2;\n",
      "Live change did not reach the receiver checkout",
    );
    let targetDoc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(await realpath(join(target, "app.ts"))),
    );
    await replace(targetDoc, "// unsaved local edit\nconst answer = 2;\n");
    await replace(sourceDoc, "const answer = 3;\n");
    await sourceDoc.save();
    await eventually(
      async () => receiver!.conflicts.has("app.ts"),
      "Dirty local file was not protected",
    );
    assert.ok(targetDoc.isDirty);
    assert.match(targetDoc.getText(), /unsaved local edit/);
    assert.equal(
      await readFile(join(target, "app.ts"), "utf8"),
      "const answer = 2;\n",
    );
    await replace(targetDoc, "const answer = 2;\n");
    await targetDoc.save();
    receiver.onState();
    await eventually(
      async () =>
        (await readFile(join(target, "app.ts"), "utf8")) ===
        "const answer = 3;\n",
      "Live synchronization did not recover after local conflict was resolved",
    );
    await b.event({
      type: "agent",
      provider: "claude",
      runId: "peer-run",
      status: "running",
      task: "Peer integration edits",
      detail: "No inference",
    });
    await receiver.begin(target, "peer-run", false);
    await replace(sourceDoc, "const answer = 4;\n");
    await sourceDoc.save();
    await eventually(
      async () =>
        (await readFile(join(target, "app.ts"), "utf8")) ===
        "const answer = 4;\n",
      "Remote edit did not apply while the receiving agent was active",
    );
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(
      a.session!.documents!.find((d) => d.file === "app.ts")!.author,
      a.credentials!.personId,
      "Remote edit echoed back with the wrong author",
    );
    await replace(targetDoc, "const answer = 5;\n");
    await targetDoc.save();
    await eventually(
      async () =>
        (await readFile(join(source, "app.ts"), "utf8")) ===
        "const answer = 5;\n",
      "Reverse-direction live edit did not apply",
    );
    await writeFile(join(source, "new.ts"), "export const live = true;\n");
    await eventually(
      async () =>
        (await readFile(join(target, "new.ts"), "utf8")) ===
        "export const live = true;\n",
      "New source file did not synchronize",
    );
    await sender.whenIdle();
    await receiver.whenIdle();
    const settings = vscode.workspace.getConfiguration("lattice");
    await settings.update("liveSync", false, vscode.ConfigurationTarget.Global);
    await replace(sourceDoc, "const answer = 6;\n");
    await sourceDoc.save();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(
      await readFile(join(target, "app.ts"), "utf8"),
      "const answer = 5;\n",
      "Paused edits should not synchronize",
    );
    await settings.update("liveSync", true, vscode.ConfigurationTarget.Global);
    await eventually(
      async () => sender!.enabled,
      "Live configuration did not resume",
    );
    sender.resume();
    receiver.onState();
    await eventually(
      async () =>
        (await readFile(join(target, "app.ts"), "utf8")) ===
        "const answer = 6;\n",
      "Resuming did not publish the paused edit",
    );
    await sender.finish();
    await receiver.finish();
    sender.dispose();
    receiver.dispose();
    targetDoc = (await findOpenFileDocument(
      join(target, "app.ts"),
      await readFile(join(target, "app.ts"), "utf8"),
    ))!;
    const secrets = new Map<string, string>();
    const context = {
      secrets: {
        get: async (key: string) => secrets.get(key),
        store: async (key: string, value: string) => {
          secrets.set(key, value);
        },
        delete: async (key: string) => {
          secrets.delete(key);
        },
      },
    } as unknown as vscode.ExtensionContext;
    const notices: string[] = [];
    const editorA = new SharedEditor(
      a,
      context,
      () => {},
      (text) => notices.push(text),
    );
    const editorB = new SharedEditor(
      b,
      context,
      () => {},
      (text) => notices.push(text),
    );
    a.on("state", () => editorA.onState());
    b.on("state", () => editorB.onState());
    try {
      await editorA.attach(sourceDoc.uri, "app.ts");
      await editorB.attach(targetDoc.uri, "app.ts");
      const edits = new vscode.WorkspaceEdit();
      edits.insert(sourceDoc.uri, new vscode.Position(0, 0), "// Alice\n");
      edits.insert(
        targetDoc.uri,
        targetDoc.positionAt(targetDoc.getText().length),
        "// Bob\n",
      );
      assert.ok(await vscode.workspace.applyEdit(edits));
      await eventually(
        async () =>
          sourceDoc.getText() === targetDoc.getText() &&
          sourceDoc.getText().includes("Alice") &&
          sourceDoc.getText().includes("Bob"),
        "Concurrent native editor changes did not merge: " + notices.join("; "),
      );
      assert.ok(
        sourceDoc.isDirty && targetDoc.isDirty,
        "Collaboration should preserve normal unsaved buffers",
      );
      b.socket!.terminate();
      await eventually(async () => !b.connected, "Peer did not disconnect");
      const offline = new vscode.WorkspaceEdit();
      offline.insert(
        targetDoc.uri,
        targetDoc.positionAt(targetDoc.getText().length),
        "// offline edit\n",
      );
      assert.ok(await vscode.workspace.applyEdit(offline));
      await eventually(
        async () =>
          b.connected &&
          sourceDoc.getText().includes("offline edit") &&
          sourceDoc.getText() === targetDoc.getText(),
        "Offline edit did not replay after reconnect: " + notices.join("; "),
      );
      await settings.update(
        "liveSync",
        false,
        vscode.ConfigurationTarget.Global,
      );
      const pausedContent = sourceDoc.getText();
      const pausedEdit = new vscode.WorkspaceEdit();
      pausedEdit.insert(
        targetDoc.uri,
        targetDoc.positionAt(targetDoc.getText().length),
        "// paused human edit\n",
      );
      assert.ok(await vscode.workspace.applyEdit(pausedEdit));
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(sourceDoc.getText(), pausedContent);
      await settings.update(
        "liveSync",
        true,
        vscode.ConfigurationTarget.Global,
      );
      editorA.onState();
      editorB.onState();
      await eventually(
        async () =>
          sourceDoc.getText().includes("paused human edit") &&
          sourceDoc.getText() === targetDoc.getText(),
        "Paused human edits did not resume",
      );
    } finally {
      editorA.dispose();
      editorB.dispose();
    }
    await sourceDoc.save();
    await targetDoc.save();
    const lifecycleA = new FileLifecycle(
      a,
      () => source,
      () => true,
      () => {},
      (text) => notices.push(text),
    );
    const lifecycleB = new FileLifecycle(
      b,
      () => target,
      () => true,
      () => {},
      (text) => notices.push(text),
    );
    a.on("state", () => lifecycleA.onState());
    b.on("state", () => lifecycleB.onState());
    try {
      for (const folder of [source, target])
        await writeFile(
          join(folder, "lifecycle.ts"),
          "export const safe = true;\n",
        );
      const rename = new vscode.WorkspaceEdit();
      rename.renameFile(
        vscode.Uri.file(join(source, "lifecycle.ts")),
        vscode.Uri.file(join(source, "renamed.ts")),
      );
      assert.ok(await vscode.workspace.applyEdit(rename));
      await eventually(
        async () =>
          (await readFile(join(target, "renamed.ts"), "utf8")).includes("safe"),
        "Rename did not propagate: " + notices.join("; "),
      );
      const deletion = new vscode.WorkspaceEdit();
      deletion.deleteFile(vscode.Uri.file(join(source, "renamed.ts")));
      assert.ok(await vscode.workspace.applyEdit(deletion));
      await eventually(
        async () =>
          readFile(join(target, "renamed.ts"), "utf8").then(
            () => false,
            (e: any) => e.code === "ENOENT",
          ),
        "Deletion did not propagate: " + notices.join("; "),
      );
    } finally {
      lifecycleA.dispose();
      lifecycleB.dispose();
    }
    const fixture = join(scratch, "fake-agent");
    await writeFile(
      fixture,
      `#!/usr/bin/env node
const readline=require('node:readline'); const fs=require('node:fs'); const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'fixture'}}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn'}}});send({method:'turn/started',params:{turn:{id:'turn'}}});setTimeout(()=>{fs.writeFileSync('agent-output.ts','export const task = '+JSON.stringify(process.cwd())+';\\n');send({method:'item/agentMessage/delta',params:{itemId:'a',delta:'Finished isolated fixture'}});send({method:'thread/tokenUsage/updated',params:{tokenUsage:{last:{inputTokens:10,outputTokens:3}}}});send({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});},700);}});
`,
    );
    await chmod(fixture, 0o755);
    const trees: TaskTree[] = [];
    const taskContext = {
      ...context,
      globalStorageUri: vscode.Uri.file(join(scratch, "storage")),
      extensionPath: vscode.workspace.workspaceFolders![0].uri.fsPath,
    } as vscode.ExtensionContext;
    const treeChanged = async (tree: TaskTree) => {
      const old = trees.find((t) => t.id === tree.id);
      if (old) Object.assign(old, tree);
      else trees.push(tree);
    };
    // Close prior run records so the concurrency limit represents these two fixtures.
    await a.event({
      type: "agent",
      provider: "codex",
      runId: "live-test",
      status: "done",
      task: "Fixture complete",
      detail: "",
    });
    const firstTask = new TaskExecutor(
      a,
      taskContext,
      source,
      () => state(a),
      { codex: fixture, claude: fixture },
      treeChanged,
      () => {},
    );
    const secondTask = new TaskExecutor(
      a,
      taskContext,
      source,
      () => state(a),
      { codex: fixture, claude: fixture },
      treeChanged,
      () => {},
    );
    const tasks = Promise.all([
      firstTask.start("First isolated task", "codex", "", "ask"),
      secondTask.start("Second isolated task", "codex", "", "ask"),
    ]);
    await eventually(
      async () =>
        a.session!.tasks!.filter(
          (t) =>
            [firstTask.id, secondTask.id].includes(t.runId) &&
            t.status === "running",
        ).length === 2,
      "Task executors did not run simultaneously",
    );
    await tasks;
    assert.equal(trees.length, 2);
    assert.notEqual(trees[0].path, trees[1].path);
    assert.ok(trees.every((t) => t.status === "review"));
    assert.equal(
      a
        .session!.usageRecords!.filter((u) =>
          [firstTask.id, secondTask.id].includes(u.runId),
        )
        .reduce((sum, u) => sum + u.input, 0),
      20,
    );
    assert.notEqual(
      await readFile(join(trees[0].path, "agent-output.ts"), "utf8"),
      await readFile(join(trees[1].path, "agent-output.ts"), "utf8"),
    );
    const result = {
      passed: true,
      checks: [
        "agent source edit propagated into another checkout",
        "unsaved local edits preserved",
        "sync recovered after conflict resolution",
        "new source file created",
        "two active agents synchronized without echo or author changes",
        "paused edits delivered after resume",
        "concurrent unsaved native editor changes merged",
        "offline collaborative edits replayed on reconnect",
        "human collaboration obeyed pause and resume",
        "native file rename and recoverable deletion propagated",
        "two local task executors ran concurrently in separate worktrees",
        "parallel task usage remained separate and additive",
      ],
      paidInference: false,
    };
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    await writeFile(
      join(root, "artifacts/vscode-live-test.json"),
      JSON.stringify(result, null, 2),
    );
    console.log("LATTICE_LIVE_SYNC_OK " + JSON.stringify(result));
  } finally {
    sender?.dispose();
    receiver?.dispose();
    a.dispose();
    b.dispose();
    await relay.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
