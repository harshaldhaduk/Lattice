import * as vscode from "vscode";
import assert from "node:assert/strict";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import { LiveSync } from "../src/extension/live-sync";
import { CodexRunner } from "../src/providers/codex";
import { git } from "../src/extension/git";
import type { AppState } from "../src/shared/protocol";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  await git(root, ["init", "-b", "main"]);
  await git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "--allow-empty",
    "-m",
    "Cursor fixture",
  ]);
  await mkdir(join(root, ".cursor-review"));
  const relay = await startRelay({ port: 0 });
  const host = new SessionClient(),
    guest = new SessionClient();
  const runner = new CodexRunner(process.env.LATTICE_CURSOR_CODEX || "codex");
  let sender: LiveSync | undefined;
  const extension = vscode.extensions.getExtension(
    "HarshalDhaduk.lattice-sync",
  )!;
  const panel = vscode.window.createWebviewPanel(
    "lattice.cursorCheck",
    "Lattice · 20-line cursor check",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, "dist")],
    },
  );
  const webview = panel.webview;
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extension.extensionUri, "dist", "webview.js"),
  );
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(extension.extensionUri, "dist", "webview.css"),
  );
  webview.html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script>window.LATTICE_MODE='live';</script><script src="${script}"></script></body></html>`;
  const observed = new Set<number>();
  try {
    const proof = await host.create(
      `ws://127.0.0.1:${relay.port}`,
      "Cursor visual check",
      "fixture",
      "main",
      { name: "Cursor test agent" },
    );
    await guest.join(proof.relay, proof.room, proof.token, {
      name: "Observer",
    });
    const state = (): AppState => ({
      me: guest.credentials!.personId,
      following: proof.personId,
      connected: true,
      liveSync: true,
      providers: [],
      repo: "fixture",
      branch: "main",
      session: guest.session,
    });
    guest.on("state", () => {
      const doc = guest.session?.documents?.find(
        (d) => d.file === "LATTICE_CURSOR_CHECK.md",
      );
      if (doc) observed.add(doc.version);
      void webview.postMessage({ type: "state", state: state() });
    });
    webview.onDidReceiveMessage(() =>
      webview.postMessage({ type: "state", state: state() }),
    );
    sender = new LiveSync(
      host,
      () => root,
      () => ({ ...state(), session: host.session, me: proof.personId }),
      () => {},
    );
    const prompt =
      "Visual cursor test. Create only LATTICE_CURSOR_CHECK.md. Write exactly 20 lines, numbered 01 through 20, with different sentence lengths. Write and flush each line separately with a 0.7 second pause between writes so a collaborator can observe every update. A Python loop with flush and sleep is fine. End each line with a newline. Do not edit any other files, install anything, or use the network. After writing, report done briefly.";
    await host.event({
      type: "entry",
      kind: "message",
      text: prompt,
      provider: "codex",
      runId: "cursor-real-prompt",
    });
    await host.event({
      type: "agent",
      provider: "codex",
      runId: "cursor-real-prompt",
      status: "running",
      task: prompt,
      detail: "Writing one line at a time",
    });
    await sender.begin(root, "cursor-real-prompt", false);
    await writeFile(
      join(root, ".cursor-review", "phase.json"),
      JSON.stringify({ phase: "real-prompt" }),
    );
    let error: string | undefined;
    const timer = setTimeout(() => void runner.stop(), 100000);
    try {
      await runner.run({
        cwd: root,
        prompt,
        mode: "ask",
        hooks: {
          text: () => {},
          tool: () => {},
          status: () => {},
          usage: () => {},
          approve: async () => false,
          ask: async () => ({}),
        },
      });
    } catch (e: any) {
      error = e.message;
    } finally {
      clearTimeout(timer);
      await sender.finish();
    }
    const content = await readFile(
      join(root, "LATTICE_CURSOR_CHECK.md"),
      "utf8",
    ).catch(() => "");
    const realLines = content.trimEnd().split("\n").filter(Boolean).length;
    await host.event({
      type: "agent",
      provider: "codex",
      runId: "cursor-real-prompt",
      status: error ? "error" : "done",
      task: prompt,
      detail: error || "Finished",
    });
    await writeFile(
      join(root, ".cursor-review", "provider-result.json"),
      JSON.stringify({ error, lines: realLines, revisions: [...observed] }),
    );
    const realRevisions = observed.size;
    // Deterministic edge cases supplement the real provider run (never reported
    // as model output). Includes tabs, blank lines, Unicode, and horizontal scroll.
    await host.event({
      type: "agent",
      provider: "codex",
      runId: "cursor-fixture",
      status: "running",
      task: "Deterministic layout edge cases",
      detail: "Layout verification",
    });
    await sender.begin(root, "cursor-fixture", false);
    let text = "";
    const cases = Array.from({ length: 20 }, (_, i) =>
      i === 5
        ? ""
        : i === 8
          ? "\tconst unicode = '漢字 🙂';"
          : `${String(i + 1).padStart(2, "0")}. ${"cursor position ".repeat(i === 15 ? 18 : (i % 5) + 1).trim()}`,
    );
    for (let i = 0; i < cases.length; i++) {
      text += cases[i] + "\n";
      await writeFile(join(root, "LATTICE_CURSOR_CHECK.md"), text);
      const synced = Date.now() + 8000;
      while (
        Date.now() < synced &&
        guest.session?.documents?.find(
          (d) => d.file === "LATTICE_CURSOR_CHECK.md",
        )?.content !== text
      )
        await pause(80);
      assert.equal(
        guest.session?.documents?.find(
          (d) => d.file === "LATTICE_CURSOR_CHECK.md",
        )?.content,
        text,
        "Second run preserves the exact untracked-file baseline",
      );
      await pause(300);
      await writeFile(
        join(root, ".cursor-review", "phase.json"),
        JSON.stringify({ phase: "fixture", step: i + 1 }),
      );
      const deadline = Date.now() + 15000;
      while (
        Date.now() < deadline &&
        (await readFile(join(root, ".cursor-review", "continue"), "utf8").catch(
          () => "",
        )) !== String(i + 1)
      )
        await pause(50);
      assert.equal(
        await readFile(join(root, ".cursor-review", "continue"), "utf8"),
        String(i + 1),
      );
    }
    await writeFile(
      join(root, ".cursor-review", "result.json"),
      JSON.stringify({
        passed: true,
        provider: { error, lines: realLines, revisions: realRevisions },
        totalRevisions: observed.size,
        fixtureLines: 20,
      }),
    );
    await pause(1500);
  } finally {
    await sender?.finish();
    sender?.dispose();
    runner.dispose();
    panel.dispose();
    host.dispose();
    guest.dispose();
    await relay.close();
  }
}
