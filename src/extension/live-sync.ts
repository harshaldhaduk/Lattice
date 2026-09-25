import { watchFile, unwatchFile, type Stats } from "node:fs";
import { findOpenFileDocument } from "./documents";
import * as vscode from "vscode";
import { readFile, realpath, mkdir } from "node:fs/promises";
import { relative, join, dirname, isAbsolute } from "node:path";
import { git, safeWorkspacePath } from "./git";
import { contentHash } from "../shared/files";
import { randomUUID } from "node:crypto";
import { textUpdate } from "../shared/collaboration";
import {
  changedCursor,
  canSyncDocument,
  sourceFile,
} from "../shared/live-files";
import type { AppState, LiveDocument } from "../shared/protocol";
import { SessionClient } from "../shared/client";
export class LiveSync implements vscode.Disposable {
  private active?: {
    cwd: string;
    runId: string;
    isolated: boolean;
    canonical?: string;
  };
  private watcher?: vscode.FileSystemWatcher;
  private polled = new Map<string, (current: Stats, previous: Stats) => void>();
  private stopPolling() {
    for (const [path, listener] of this.polled) unwatchFile(path, listener);
    this.polled.clear();
  }
  private pollTouchedFile(uri: vscode.Uri) {
    if (this.polled.has(uri.fsPath) || this.polled.size >= 100) return;
    const listener = (current: Stats, previous: Stats) => {
      if (
        current.mtimeMs !== previous.mtimeMs ||
        current.size !== previous.size
      )
        this.schedule(uri);
    };
    this.polled.set(uri.fsPath, listener);
    // macOS can coalesce filesystem events while a tool holds a file open.
    // Poll only touched source files during the agent turn, never the whole tree.
    watchFile(uri.fsPath, { interval: 150, persistent: false }, listener);
  }
  private base = new Map<
    string,
    { content: string; missing: boolean; crdt?: string; seed?: string }
  >();
  private timers = new Map<string, NodeJS.Timeout>();
  private work = new Map<string, Promise<void>>();
  private receiving = new Map<string, Promise<void>>();
  private suppress = new Set<string>();
  private applied = new Map<string, string>();
  private versions = new Map<string, number>();
  private room = "";
  private disposed = false;
  private pausedFiles = new Set<string>();
  private initialUntracked = new Set<string>();
  readonly conflicts = new Map<string, string>();
  excluded: (file: string) => boolean = () => false;
  receiveExcluded: () => boolean = () => false;
  private listener: vscode.Disposable;
  constructor(
    private client: SessionClient,
    private root: () => string,
    private state: () => AppState,
    private changed: () => void,
  ) {
    this.listener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length) this.schedule(e.document.uri);
    });
  }
  get enabled() {
    return vscode.workspace.getConfiguration("lattice").get("liveSync", true);
  }
  private conflict(file: string, reason: string) {
    if (this.conflicts.get(file) === reason) return;
    this.conflicts.set(file, reason);
    this.changed();
  }
  async begin(cwd: string, runId: string, isolated: boolean) {
    this.watcher?.dispose();
    this.stopPolling();
    this.base.clear();
    this.pausedFiles.clear();
    this.initialUntracked = new Set(
      (
        await git(cwd, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
        ]).catch(() => "")
      )
        .split("\0")
        .filter(Boolean),
    );
    this.active = { cwd, runId, isolated, canonical: await realpath(cwd) };
    const modified = (
      await git(cwd, ["diff", "--name-only", "-z"]).catch(() => "")
    )
      .split("\0")
      .filter(Boolean);
    for (const file of new Set(
      [...modified, ...this.initialUntracked].filter(sourceFile),
    )) {
      try {
        const content = await readFile(await safeWorkspacePath(cwd, file), "utf8");
        if (content.length <= 32000) {
          this.base.set(file, { content, missing: false });
          this.pollTouchedFile(vscode.Uri.file(join(cwd, file)));
        }
      } catch {}
    }
    if (this.disposed) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(cwd, "**/*"),
      false,
      false,
      false,
    );
    this.watcher.onDidChange((uri) => this.schedule(uri));
    this.watcher.onDidCreate((uri) => this.schedule(uri));
    this.watcher.onDidDelete((uri) => this.schedule(uri));
  }
  private schedule(uri: vscode.Uri) {
    if (
      !this.active ||
      !this.client.connected ||
      uri.scheme !== "file" ||
      this.suppress.has(uri.fsPath)
    )
      return;
    let file = relative(this.active.cwd, uri.fsPath).split("\\").join("/");
    if (file.startsWith("../") && this.active.canonical)
      file = relative(this.active.canonical, uri.fsPath).split("\\").join("/");
    if (this.receiving.has("main:" + file)) return;
    if (this.excluded(file)) return;
    if (file.startsWith("../") || isAbsolute(file) || !sourceFile(file)) return;
    this.pollTouchedFile(uri);
    if (!this.enabled) {
      this.pausedFiles.add(file);
      return;
    }
    if (this.timers.has(file)) return;
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        this.enqueuePublish(file);
      }, 90),
    );
  }
  async whenIdle() {
    await Promise.allSettled([
      ...this.receiving.values(),
      ...this.work.values(),
    ]);
  }
  resume() {
    if (!this.enabled) return;
    for (const file of this.pausedFiles) this.enqueuePublish(file);
    this.pausedFiles.clear();
    this.onState();
  }
  private enqueuePublish(file: string) {
    const active = this.active;
    if (!active) return;
    const previous = this.work.get(file) || Promise.resolve();
    const task = previous
      .then(() => this.publish(file, active))
      .catch((e: any) => this.conflict(file, e.message));
    this.work.set(file, task);
    void task.finally(() => {
      if (this.work.get(file) === task) this.work.delete(file);
    });
  }
  private async publish(file: string, active: NonNullable<LiveSync["active"]>) {
    if (!this.enabled) {
      this.pausedFiles.add(file);
      return;
    }
    if (!this.client.connected || this.disposed) return;
    let full: string;
    try {
      full = await safeWorkspacePath(active.cwd, file);
    } catch (e: any) {
      if (e.code !== "ENOENT" || active.isolated) throw e;
      const previous =
        this.base.get(file)?.content ??
        (await git(active.cwd, ["show", `HEAD:${file}`], true).catch(
          () => undefined,
        ));
      if (previous === undefined) return;
      const operations = this.state().session?.operations || [];
      if (
        operations.some(
          (op) =>
            op.file === file &&
            !op.target &&
            op.beforeHash === contentHash(previous),
        )
      )
        return;
      await this.client.event({
        type: "document.operation",
        id: randomUUID(),
        file,
        beforeHash: contentHash(previous),
      });
      this.base.delete(file);
      return;
    }
    if (this.suppress.has(full)) return;
    const document = await findOpenFileDocument(full);
    const content = document?.isDirty
      ? document.getText()
      : await readFile(full, "utf8");
    if (content.length > 32000 || content.includes("\0")) return;
    const ignored = await git(active.cwd, ["check-ignore", "--", file]).then(
      () => true,
      () => false,
    );
    if (ignored) return;
    let base = this.base.get(file);
    if (!base) {
      try {
        base = {
          content: await git(active.cwd, ["show", `HEAD:${file}`], true),
          missing: false,
        };
      } catch {
        base = { content: "", missing: true };
      }
      this.base.set(file, base);
    }
    if (content === base.content) return;
    const shared = this.state().session?.documents?.find(
      (d) => d.key === (active.isolated ? active.runId : "main") + ":" + file,
    );
    if (!base.crdt && shared?.content === base.content && shared.crdtState) {
      base.crdt = shared.crdtState;
      base.seed = shared.crdtBaseContent;
    }
    const seed = base.seed ?? base.content;
    const collaborative = textUpdate(base.content, content, base.crdt);
    const cursor = changedCursor(base.content, content);
    this.applied.set(
      (active.isolated ? active.runId : "main") + ":" + file,
      contentHash(content),
    );
    await this.client.event({
      type: "document.update",
      file,
      runId: active.runId,
      isolated: active.isolated,
      beforeHash: contentHash(base.content),
      baseMissing: base.missing,
      content,
      ...cursor,
      collaboration: {
        base: seed,
        baseHash: contentHash(seed),
        update: collaborative.update,
      },
    });
    this.base.set(file, {
      content,
      missing: false,
      crdt: collaborative.state,
      seed,
    });
    this.conflicts.delete(file);
  }
  async finish() {
    const active = this.active;
    if (!active || this.disposed) return;
    this.stopPolling();
    await new Promise((r) => setTimeout(r, 140));
    // Catch final atomic writes even if the OS watcher delivers its notification late.
    if (this.enabled) {
      const changed = (
        await git(active.cwd, ["diff", "--name-only", "-z"]).catch(() => "")
      )
        .split("\0")
        .filter(Boolean);
      const added = (
        await git(active.cwd, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
        ]).catch(() => "")
      )
        .split("\0")
        .filter((f) => f && !this.initialUntracked.has(f));
      for (const file of new Set([...changed, ...added, ...this.base.keys()]))
        if (sourceFile(file)) this.enqueuePublish(file);
    }
    for (const [file, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(file);
      this.enqueuePublish(file);
    }
    await Promise.allSettled([...this.work.values()]);
    this.watcher?.dispose();
    this.watcher = undefined;
    this.active = undefined;
    this.stopPolling();
  }
  onState() {
    if (this.disposed) return;
    if (this.receiveExcluded()) return;
    const state = this.state(),
      session = state.session;
    if (this.room !== (session?.id || "")) {
      this.room = session?.id || "";
      this.applied.clear();
      this.versions.clear();
      this.conflicts.clear();
    }
    if (
      !this.enabled ||
      !state.connected ||
      !session ||
      !vscode.workspace.isTrusted ||
      session.people.find((p) => p.id === state.me)?.role === "viewer"
    )
      return;
    for (const doc of session.documents || []) {
      if (
        this.excluded(doc.file) ||
        doc.isolated ||
        this.versions.get(doc.key) === doc.version ||
        this.receiving.has(doc.key)
      )
        continue;
      const room = this.room;
      const task = this.receive(doc, room).catch((e: any) =>
        this.conflict(doc.file, e.message),
      );
      this.receiving.set(doc.key, task);
      void task.finally(() => {
        this.receiving.delete(doc.key);
        const latest = this.state().session?.documents?.find(
          (d) => d.key === doc.key,
        );
        if (latest && latest.version > doc.version) this.onState();
      });
    }
  }
  private async receive(shared: LiveDocument, room: string) {
    if (!sourceFile(shared.file)) return;
    const root = this.root();
    const canonicalRoot = await realpath(root);
    const full = join(root, shared.file);
    const rel = relative(root, full);
    if (rel.startsWith("../") || isAbsolute(rel))
      throw Error("File is outside the workspace.");
    let disk: string | undefined;
    try {
      await safeWorkspacePath(root, shared.file);
      disk = await readFile(full, "utf8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    const open = await findOpenFileDocument(full, disk);
    const uri = open?.uri || vscode.Uri.file(full);
    const baseline = this.base.get(shared.file);
    if (
      shared.crdtState &&
      this.active &&
      !this.active.isolated &&
      !open?.isDirty &&
      disk !== undefined &&
      baseline &&
      disk !== baseline.content &&
      contentHash(disk) !== shared.hash &&
      contentHash(disk) !== this.applied.get(shared.key)
    ) {
      await this.publish(shared.file, this.active);
      return;
    }
    const check = canSyncDocument(
      shared,
      open?.isDirty ? open.getText() : disk,
      !!open?.isDirty,
      this.applied.get(shared.key),
    );
    if (!check.ok) {
      this.conflict(shared.file, check.reason!);
      return;
    }
    if (
      room !== this.room ||
      this.disposed ||
      !this.enabled ||
      !this.client.connected ||
      this.state().session?.people.find((p) => p.id === this.state().me)
        ?.role === "viewer"
    )
      return;
    if (!check.unchanged) {
      this.suppress.add(full);
      try {
        if (disk === undefined) {
          // Resolve the nearest existing parent before allowing creation through directories.
          let parent = dirname(full);
          for (;;) {
            try {
              const resolved = await realpath(parent);
              const path = relative(canonicalRoot, resolved);
              if (path === ".." || path.startsWith("../") || isAbsolute(path))
                throw Error("File parent is outside the workspace.");
              break;
            } catch (e: any) {
              if (e.code !== "ENOENT") throw e;
              const next = dirname(parent);
              if (next === parent) throw e;
              parent = next;
            }
          }
          await mkdir(dirname(full), { recursive: true });
          const edit = new vscode.WorkspaceEdit();
          edit.createFile(uri, { overwrite: false });
          edit.insert(uri, new vscode.Position(0, 0), shared.content);
          if (!(await vscode.workspace.applyEdit(edit)))
            throw Error("Could not create the live file.");
        } else {
          const doc = open || (await vscode.workspace.openTextDocument(uri));
          if (doc.isDirty || doc.getText() !== disk)
            throw Error("The local editor changed during synchronization.");
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            uri,
            new vscode.Range(
              doc.positionAt(0),
              doc.positionAt(doc.getText().length),
            ),
            shared.content,
          );
          if (!(await vscode.workspace.applyEdit(edit)))
            throw Error("The local file changed during synchronization.");
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        if (!(await doc.save()))
          throw Error("The live edit could not be saved.");
        if (contentHash(doc.getText()) !== shared.hash)
          throw Error("A save action changed the live edit.");
      } finally {
        this.suppress.delete(full);
      }
    }
    if (this.active && !this.active.isolated) {
      const activeRoot = await realpath(this.active.cwd);
      if (activeRoot === canonicalRoot)
        this.base.set(shared.file, {
          content: shared.content,
          missing: false,
          crdt: shared.crdtState,
          seed: shared.crdtBaseContent,
        });
    }
    this.applied.set(shared.key, shared.hash);
    this.versions.set(shared.key, shared.version);
    this.conflicts.delete(shared.file);
    this.changed();
  }
  dispose() {
    this.disposed = true;
    this.stopPolling();
    this.listener.dispose();
    this.watcher?.dispose();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
