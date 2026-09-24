import { rememberProject, openInSameWindow } from "./workspace-navigation";
import * as vscode from "vscode";
import {
  mkdir,
  readFile,
  realpath,
  writeFile,
  stat,
  lstat,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { SessionClient } from "../shared/client";
import { WorkspaceMirror, safeMirrorPath } from "./workspace-mirror";
import { byteHash, workspacePath } from "../shared/workspace";
import { git } from "./git";
import { findOpenFileDocument } from "./documents";
export class SessionWorkspace {
  private mirror?: WorkspaceMirror;
  private subscriptions: vscode.Disposable[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  active = false;
  loading = false;
  get conflicts() {
    return this.mirror?.conflicts || new Map<string, string>();
  }
  constructor(
    private client: SessionClient,
    private context: vscode.ExtensionContext,
    private status: (text: string) => void,
    private notice: (text: string) => void,
  ) {}
  private cache() {
    return join(
      this.context.globalStorageUri.fsPath,
      "workspace-cache",
      `${this.client.session!.id}-${this.client.credentials!.personId}.json`,
    );
  }
  async start(root: string, host = false) {
    this.dispose();
    this.active = true;
    this.status(
      host ? "Sharing the live workspace…" : "Loading the live workspace…",
    );
    const read = async (file: string) => {
      const path = await safeMirrorPath(root, file);
      const doc = await findOpenFileDocument(path);
      if (doc) return Buffer.from(doc.getText());
      return readFile(path).catch((e: any) => {
        if (e.code !== "ENOENT") throw e;
        return undefined;
      });
    };
    this.mirror = new WorkspaceMirror(
      this.client,
      root,
      this.cache(),
      this.notice,
      {
        read,
        write: async (file, bytes, expected) => {
          const path = await safeMirrorPath(root, file);
          const current = await read(file);
          if ((current ? byteHash(current) : null) !== expected)
            throw Error(
              `Local edit arrived while receiving ${file}; it was preserved.`,
            );
          const doc = await findOpenFileDocument(path);
          const uri = doc?.uri || vscode.Uri.file(path);
          // Re-check after resolving aliases, before touching a possibly dirty buffer.
          if (doc && byteHash(Buffer.from(doc.getText())) !== expected)
            throw Error(`Local changes in ${file} were preserved.`);
          if (!bytes) {
            await vscode.workspace.fs.delete(uri, { useTrash: true });
            return;
          }
          await mkdir(dirname(path), { recursive: true });
          if (doc) {
            if (
              bytes.includes(0) ||
              !Buffer.from(bytes.toString("utf8")).equals(bytes)
            )
              throw Error(
                `Close the text editor before updating binary file ${file}.`,
              );
            const dirty = doc.isDirty;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
              uri,
              new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length),
              ),
              bytes.toString("utf8"),
            );
            if (!(await vscode.workspace.applyEdit(edit)))
              throw Error(`Could not apply ${file}.`);
            if (!dirty) await doc.save();
          } else await vscode.workspace.fs.writeFile(uri, bytes);
        },
      },
      () => vscode.workspace.getConfiguration("lattice").get("liveSync", true),
    );
    try {
      await this.mirror.start(host);
    } catch (e) {
      this.dispose();
      throw e;
    }
    const canonicalRoot = await realpath(root);
    const schedule = (uri: vscode.Uri) => {
      void (async () => {
        if (uri.scheme !== "file") return;
        const canonical = await realpath(uri.fsPath).catch(() => uri.fsPath);
        const file = relative(canonicalRoot, canonical).split("\\").join("/");
        if (!workspacePath(file)) return;
        clearTimeout(this.timers.get(file));
        this.timers.set(
          file,
          setTimeout(() => {
            this.timers.delete(file);
            void this.mirror?.publish(file);
          }, 100),
        );
      })().catch((e) => this.notice(e.message));
    };
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, "**/*"),
    );
    this.subscriptions.push(
      watcher,
      watcher.onDidChange(schedule),
      watcher.onDidCreate(schedule),
      watcher.onDidDelete(schedule),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length) schedule(e.document.uri);
      }),
    );
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("lattice.liveSync")) this.mirror?.resume();
      }),
    );
    this.status(
      `Live workspace · ${this.client.session?.workspace?.files || 0} files`,
    );
    const skipped = this.client.session?.workspace?.skipped || [];
    if (skipped.length)
      this.notice(
        `Workspace opened. ${skipped.length} oversized or unreadable files were omitted: ${skipped.slice(0, 4).join(", ")}`,
      );
  }
  async prepareJoined() {
    this.loading = true;
    const session = this.client.session!;
    const root = join(
      this.context.globalStorageUri.fsPath,
      "session-workspaces",
      session.id,
    );
    try {
      if (
        session.lifecycle &&
        !(await stat(join(root, ".git")).catch(() => undefined))
      ) {
        const remote = session.lifecycle.remote;
        if (
          !/^(?:https:\/\/github\.com\/|git@github\.com:)[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(
            remote,
          )
        )
          throw Error(
            "This session needs a GitHub repository remote to prepare its shared Git history.",
          );
        this.status("Preparing the session's Git history…");
        await mkdir(dirname(root), { recursive: true });
        await git(dirname(root), [
          "clone",
          "--no-checkout",
          "--",
          remote,
          root,
        ]);
        await git(root, [
          "checkout",
          "-b",
          session.branch,
          session.lifecycle.baseCommit,
        ]);
        const baseline: Record<string, string> = {};
        for (const file of (await git(root, ["ls-files", "-z"], true))
          .split("\0")
          .filter(Boolean)) {
          if (workspacePath(file) && (await lstat(join(root, file))).isFile())
            baseline[file] = byteHash(await readFile(join(root, file)));
        }
        await mkdir(dirname(this.cache()), { recursive: true });
        await writeFile(this.cache(), JSON.stringify(baseline));
      }
      await this.start(root);
      // This repository is an internal session snapshot, never the user's existing checkout.
      if (!(await stat(join(root, ".git")).catch(() => undefined))) {
        await git(root, ["init", "-b", "session"]);
        await git(root, ["add", "--all"]);
        await git(root, [
          "-c",
          "user.name=Lattice",
          "-c",
          "user.email=session@localhost",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "--allow-empty",
          "-m",
          "Live workspace snapshot",
        ]);
      }
      const credentials = this.client.credentials!;
      await this.context.secrets.store(
        "session:" + vscode.Uri.file(root).toString(),
        JSON.stringify(credentials),
      );
      await this.context.globalState.update(
        "managedWorkspace:" + session.id,
        root,
      );
      return root;
    } finally {
      this.loading = false;
    }
  }
  async openJoined() {
    const root = await this.prepareJoined();
    await rememberProject(this.context, root);
    this.dispose();
    await this.client.disconnect();
    const previous = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (previous && previous.fsPath !== root)
      await this.context.secrets.delete("session:" + previous.toString());
    await openInSameWindow(root);
  }
  dispose() {
    this.active = false;
    this.mirror?.dispose();
    this.mirror = undefined;
    for (const item of this.subscriptions) item.dispose();
    this.subscriptions = [];
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
