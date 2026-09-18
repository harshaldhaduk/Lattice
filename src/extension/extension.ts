import { NativePresence, presenceLocation } from "./native-presence";
import { join } from "node:path";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { Controller } from "./controller";
import { initials, type AppState } from "../shared/protocol";
class View implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(
    private context: vscode.ExtensionContext,
    private controller: Controller,
    private mode: "sidebar" | "composer",
  ) {
    controller.on("change", (state: AppState) =>
      this.view?.webview.postMessage({ type: "state", state }),
    );
    controller.on("webview", (data: any) =>
      this.view?.webview.postMessage(data),
    );
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };
    const script = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const css = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    const nonce = randomBytes(24).toString("base64");
    view.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource} https://avatars.githubusercontent.com data:; style-src ${view.webview.cspSource} 'unsafe-inline'; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script nonce="${nonce}">window.LATTICE_MODE='${this.mode}'</script><script nonce="${nonce}" src="${script}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m) => void this.controller.action(m));
    view.onDidChangeVisibility(() => this.controller.emitState());
  }
}
export async function activate(context: vscode.ExtensionContext) {
  const c = new Controller(context);
  context.subscriptions.push({ dispose: () => c.dispose() });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "lattice.people",
      new View(context, c, "sidebar"),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      "lattice.composer",
      new View(context, c, "composer"),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  const dashboard = vscode.window.createTreeView("lattice.sessions", {
    treeDataProvider: {
      getChildren: () => [
        "Your sessions",
        "New session",
        "Join with invitation",
      ],
      getTreeItem: (label: string) => ({
        label,
        command: {
          command:
            label === "Your sessions"
              ? "lattice.dashboard"
              : label === "New session"
                ? "lattice.newSession"
                : "lattice.join",
          title: label,
        },
      }),
    },
  });
  context.subscriptions.push(
    dashboard,
    dashboard.onDidChangeVisibility((e) => {
      if (e.visible) void c.openDashboard();
    }),
  );
  const cmd = (id: string, fn: () => any) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          await fn();
        } catch (e: any) {
          vscode.window.showErrorMessage(e.message);
        }
      }),
    );
  cmd("lattice.dashboard", () => c.openDashboard());
  cmd("lattice.newSession", async () => {
    const title = await vscode.window.showInputBox({
      title: "What are you building?",
    });
    if (title?.trim()) await c.flow.create(title.trim());
  });
  cmd("lattice.open", () => c.open());
  cmd("lattice.shareFile", () => c.fileSharing.shareActive());
  cmd("lattice.collaborate", () => c.sharedEditor.shareCurrent());
  cmd("lattice.sessionTools", () => c.sessionTools());
  cmd("lattice.history", () => c.history());
  cmd("lattice.signIn", () => c.signIn());
  cmd("lattice.host", async () => {
    const title = await vscode.window.showInputBox({
      title: "Start a shared session",
      prompt: "What are you building?",
    });
    if (title) await c.flow.create(title);
  });
  cmd("lattice.join", async () => {
    const link = await vscode.window.showInputBox({
      title: "Join a session",
      prompt: "Paste your invite link",
    });
    if (link) await c.join(link);
  });
  cmd("lattice.invite", () => c.invite());
  cmd("lattice.profile", () => c.profileDialog());
  cmd("lattice.providers", () => c.connectProviders());
  cmd("lattice.comment", () => c.commentSelection());
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        try {
          await c.join(uri.toString(true));
        } catch (e: any) {
          vscode.window.showErrorMessage(e.message);
        }
      },
    }),
  );
  const liveLocation = (p: import("../shared/protocol").Person) =>
    presenceLocation(c.state, p);
  const decorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  context.subscriptions.push(
    decorations,
    vscode.window.registerFileDecorationProvider({
      onDidChangeFileDecorations: decorations.event,
      provideFileDecoration(uri) {
        const file = vscode.workspace.asRelativePath(uri, false);
        const peers =
          c.state.session?.people.filter(
            (p) =>
              p.online && liveLocation(p).file === file && p.id !== c.state.me,
          ) || [];
        if (!peers.length) return;
        return {
          badge:
            peers.length === 1 ? initials(peers[0].name) : String(peers.length),
          tooltip: peers
            .map(
              (p) =>
                `${p.name}${p.agent?.status === "running" ? " · agent working" : ""}`,
            )
            .join(", "),
          color: new vscode.ThemeColor("charts.blue"),
          propagate: false,
        };
      },
    }),
  );
  const presenceMarkers = new NativePresence(
    () => c.state,
    join(context.globalStorageUri.fsPath, "avatars"),
  );
  context.subscriptions.push(presenceMarkers);
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  status.command = "lattice.open";
  status.text = "$(radio-tower) Lattice";
  status.show();
  context.subscriptions.push(status);
  let updateTimer: NodeJS.Timeout | undefined;
  c.on("change", () => {
    presenceMarkers.refresh();
    status.text = c.state.session
      ? `$(radio-tower) ${c.state.session.people.filter((p) => p.online).length} in session`
      : "$(radio-tower) Lattice";
    if (!updateTimer)
      updateTimer = setTimeout(() => {
        updateTimer = undefined;
        decorations.fire(undefined);
      }, 80);
  });
  let presenceTimer: NodeJS.Timeout | undefined;
  const presence = () => {
    // Throttle rather than debounce: publish even while the cursor keeps moving.
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = undefined;
      c.publishPresence();
    }, 80);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(presence),
    vscode.window.onDidChangeTextEditorSelection(presence),
    {
      dispose: () => {
        clearTimeout(updateTimer);
        clearTimeout(presenceTimer);
      },
    },
  );
  await c.initialize();
}
export function deactivate() {}
