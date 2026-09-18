import * as vscode from "vscode";
import { readFile, realpath, mkdir, lstat } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { contentHash } from "../shared/files";
import { sourceFile } from "../shared/live-files";
import { safeWorkspacePath, git } from "./git";
import { findOpenFileDocument } from "./documents";
import { SessionClient } from "../shared/client";

export class FileLifecycle implements vscode.Disposable {
  private subscriptions: vscode.Disposable[] = [];
  private hashes = new Map<string, string>();
  private seen = new Set<string>();
  private applying = false;
  private room = "";
  private disposed = false;
  constructor(
    private client: SessionClient,
    private root: () => string,
    private enabled: () => boolean,
    private changed: () => void,
    private notice: (message: string) => void,
  ) {
    this.room = client.session?.id || "";
    this.seen = new Set(client.session?.operations?.map((op) => op.id) || []);
    const prepare = async (uris: readonly vscode.Uri[]) => {
      if (this.applying || !this.client.connected || !this.enabled()) return;
      for (const uri of uris) {
        const file = relative(this.root(), uri.fsPath);
        if (!sourceFile(file) || file.startsWith("..") || isAbsolute(file))
          continue;
        if ((await lstat(uri.fsPath)).isSymbolicLink()) continue;
        if (
          await git(this.root(), ["check-ignore", "--", file]).then(
            () => true,
            () => false,
          )
        )
          continue;
        const full = await safeWorkspacePath(this.root(), file);
        const open = await findOpenFileDocument(full);
        if (!open?.isDirty)
          this.hashes.set(file, contentHash(await readFile(full, "utf8")));
      }
    };
    this.subscriptions.push(
      vscode.workspace.onWillRenameFiles((e) =>
        e.waitUntil(prepare(e.files.map((f) => f.oldUri))),
      ),
      vscode.workspace.onWillDeleteFiles((e) => e.waitUntil(prepare(e.files))),
      vscode.workspace.onDidRenameFiles((e) => {
        if (!this.applying)
          for (const file of e.files)
            void this.publish(file.oldUri, file.newUri);
      }),
      vscode.workspace.onDidDeleteFiles((e) => {
        if (!this.applying) for (const file of e.files) void this.publish(file);
      }),
    );
  }
  private async publish(uri: vscode.Uri, targetUri?: vscode.Uri) {
    if (!this.enabled() || !this.client.connected) return;
    const file = relative(this.root(), uri.fsPath);
    const beforeHash = this.hashes.get(file);
    this.hashes.delete(file);
    if (!beforeHash) return;
    const target = targetUri
      ? relative(this.root(), targetUri.fsPath)
      : undefined;
    try {
      await this.client.event({
        type: "document.operation",
        id: randomUUID(),
        file,
        target,
        beforeHash,
      });
    } catch (e: any) {
      this.notice(e.message);
    }
  }
  onState() {
    if (this.disposed) return;
    if (this.room !== this.client.session?.id) {
      // A fresh membership must not replay old destructive operations against a
      // newly opened checkout. Temporary socket reconnects retain the same room.
      this.seen = new Set(
        this.client.session?.operations?.map((op) => op.id) || [],
      );
      this.room = this.client.session?.id || "";
    }
    if (this.applying || !this.enabled() || !this.client.connected) return;
    const me = this.client.session?.people.find(
      (p) => p.id === this.client.credentials?.personId,
    );
    if (!me || me.role === "viewer") return;
    const operations =
      this.client.session?.operations?.filter((op) => !this.seen.has(op.id)) ||
      [];
    if (!operations.length) return;
    this.applying = true;
    void (async () => {
      for (const operation of operations) {
        if (
          this.disposed ||
          !this.enabled() ||
          this.client.session?.id !== this.room
        )
          break;
        this.seen.add(operation.id);
        if (operation.author === me.id) continue;
        try {
          if ((await lstat(join(this.root(), operation.file))).isSymbolicLink())
            throw Error(
              "Symbolic links are excluded from shared file operations.",
            );
          const full = await safeWorkspacePath(this.root(), operation.file);
          const open = await findOpenFileDocument(full);
          if (
            open?.isDirty ||
            contentHash(await readFile(full, "utf8")) !== operation.beforeHash
          )
            throw Error(
              `Preserved ${operation.file}: local changes prevent ${operation.target ? "rename" : "deletion"}.`,
            );
          if (operation.target) {
            if (!sourceFile(operation.target))
              throw Error("Unsupported rename destination.");
            const target = join(this.root(), operation.target);
            let parent = dirname(target);
            for (;;) {
              try {
                const rel = relative(
                  await realpath(this.root()),
                  await realpath(parent),
                );
                if (rel.startsWith("..") || isAbsolute(rel))
                  throw Error("Rename destination is outside the workspace.");
                break;
              } catch (e: any) {
                if (e.code !== "ENOENT") throw e;
                parent = dirname(parent);
              }
            }
            await mkdir(dirname(target), { recursive: true });
            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(
              open?.uri || vscode.Uri.file(full),
              vscode.Uri.file(target),
              { overwrite: false },
            );
            if (!(await vscode.workspace.applyEdit(edit)))
              throw Error("Could not apply the shared rename.");
          } else
            await vscode.workspace.fs.delete(
              open?.uri || vscode.Uri.file(full),
              { useTrash: true },
            );
        } catch (e: any) {
          if (e.code !== "ENOENT") this.notice(e.message);
        }
      }
    })().finally(() => {
      this.applying = false;
      this.changed();
      this.onState();
    });
  }
  dispose() {
    this.disposed = true;
    for (const sub of this.subscriptions) sub.dispose();
  }
}
