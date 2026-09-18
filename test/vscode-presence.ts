import * as vscode from "vscode";
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import {
  NativePresence,
  presenceLocation,
} from "../src/extension/native-presence";
import type { AppState } from "../src/shared/protocol";
import { contentHash } from "../src/shared/files";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const phase = async (name: string) => {
    await writeFile(join(root, "phase.json"), JSON.stringify({ phase: name }));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (
        (await readFile(join(root, "continue"), "utf8").catch(() => "")) ===
        name
      )
        return;
      await pause(50);
    }
    throw Error(`Visual harness did not finish phase: ${name}`);
  };
  const relay = await startRelay({ port: 0 });
  const alice = new SessionClient(),
    bob = new SessionClient();
  let markers: NativePresence | undefined;
  try {
    const credentials = await alice.create(
      `ws://127.0.0.1:${relay.port}`,
      "Native avatar check",
      "repo",
      "main",
      { name: "Alice" },
    );
    await bob.join(credentials.relay, credentials.room, credentials.token, {
      name: "Bob",
    });
    const state = (): AppState => ({
      me: credentials.personId,
      connected: alice.connected,
      session: alice.session,
      providers: [],
      repo: "repo",
      branch: "main",
    });
    const file = join(root, "presence.ts");
    const source =
      Array.from(
        { length: 20 },
        (_, i) =>
          `export const value${String(i).padStart(2, "0")} = "the code remains editable while Bob moves";`,
      ).join("\n") + "\n";
    await writeFile(file, source);
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc);
    markers = new NativePresence(state, join(root, "avatars"));
    alice.on("state", () => markers?.refresh());
    await bob.event({
      type: "presence",
      file: "presence.ts",
      line: 3,
      column: 5,
    });
    await pause(500);
    assert.equal(
      state().session!.people.find((p) => p.name === "Bob")!.column,
      5,
    );
    await phase("initial");

    // Harness samples the native Monaco DOM at 20ms while a single move animates.
    await writeFile(
      join(root, "phase.json"),
      JSON.stringify({ phase: "moving" }),
    );
    for (let i = 0; i < 6; i++) {
      await bob.event({
        type: "presence",
        file: "presence.ts",
        line: 3,
        column: i % 2 === 0 ? 55 : 5,
      });
      await pause(550);
    }
    assert.equal(doc.getText(), source, "Presence must not alter the buffer");
    assert.equal(doc.isDirty, false, "Presence must not dirty the file");
    assert.equal(
      editor.selection.active.character,
      0,
      "Presence must not move the local cursor",
    );
    await phase("moved");

    await bob.event({
      type: "agent",
      provider: "codex",
      runId: "native-edit",
      status: "running",
      task: "Native editor fixture",
      detail: "No inference",
    });
    await bob.event({
      type: "document.update",
      isolated: false,
      file: "presence.ts",
      runId: "native-edit",
      beforeHash: contentHash(source),
      baseMissing: false,
      content: source,
      line: 8,
      column: 30,
    });
    await pause(250);
    await phase("agent");
    // The viewing cursor remains at line 3; the native marker must use the agent's line 8.
    assert.equal(
      presenceLocation(
        state(),
        state().session!.people.find((p) => p.name === "Bob")!,
      ).line,
      8,
    );
    await bob.event({
      type: "agent",
      provider: "codex",
      runId: "native-edit",
      status: "done",
      task: "Native editor fixture",
      detail: "Finished",
    });
    await pause(250);

    // Native decorations must coexist with real unsaved edits and shorter lines.
    await editor.edit((builder) =>
      builder.replace(
        new vscode.Range(3, 0, 3, doc.lineAt(3).text.length),
        "const x = 1;",
      ),
    );
    assert.ok(doc.isDirty);
    await bob.event({
      type: "presence",
      file: "presence.ts",
      line: 3,
      column: 500,
    });
    await pause(250);
    await phase("edited");

    await vscode.workspace
      .getConfiguration("lattice")
      .update("animatePresence", false, vscode.ConfigurationTarget.Global);
    await bob.event({
      type: "presence",
      file: "presence.ts",
      line: 5,
      column: 40,
    });
    await pause(250);
    await phase("reduced");
    await bob.event({ type: "presence", file: "other.ts", line: 0, column: 0 });
    await pause(250);
    await phase("hidden");
    await bob.event({
      type: "presence",
      file: "presence.ts",
      line: 3,
      column: 4,
    });
    await pause(250);
    await phase("returned");

    // Isolated worktrees must not put their agent cursor over main-checkout files.
    const person = state().session!.people.find((p) => p.name === "Bob")!;
    const synthetic = structuredClone(state());
    synthetic.session!.people.find((p) => p.id === person.id)!.agent = {
      provider: "codex",
      status: "running",
      runId: "isolated",
      task: "fixture",
      detail: "fixture",
    };
    synthetic.session!.documents = [
      {
        key: "isolated",
        isolated: true,
        file: "private.ts",
        author: person.id,
        runId: "isolated",
        provider: "codex",
        content: "",
        hash: "",
        previousHash: "",
        baseHash: "",
        baseMissing: false,
        version: 1,
        line: 9,
        column: 20,
        updated: Date.now(),
      },
    ];
    assert.equal(
      presenceLocation(
        synthetic,
        synthetic.session!.people.find((p) => p.id === person.id)!,
      ).file,
      "presence.ts",
    );

    bob.dispose();
    await pause(300);
    await phase("offline");
    markers.dispose();
    markers = undefined;
    await writeFile(
      join(root, "result.json"),
      JSON.stringify({
        passed: true,
        checks: [
          "column presence over real relay",
          "native avatar interpolation",
          "agent position from streamed document",
          "normal buffer and local cursor preserved",
          "unsaved editor changes",
          "short-line clamping",
          "reduced motion",
          "file switch cleanup",
          "offline cleanup",
          "isolated worktree exclusion",
        ],
      }),
    );
  } finally {
    markers?.dispose();
    alice.dispose();
    bob.dispose();
    await relay.close();
  }
}
