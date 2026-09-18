import { readFile } from "node:fs/promises";
import { findOpenFileDocument } from "./documents";
import * as vscode from "vscode";
import { relative } from "node:path";
import { git, safeWorkspacePath } from "./git";
import { contentHash, checkFileApply } from "../shared/files";
import {
  eventSchema,
  type SessionEvent,
  type FileShare,
} from "../shared/protocol";
export class FileSharing implements vscode.TextDocumentContentProvider {
  private reviewed = new Map<string, { hash: string; localHash: string }>();
  constructor(
    private root: () => string,
    private shares: () => FileShare[],
    private send: (e: SessionEvent) => Promise<unknown>,
  ) {}
  get reviewedIds() {
    return this.shares()
      .filter((f) => this.reviewed.get(f.id)?.hash === f.hash)
      .map((f) => f.id);
  }
  provideTextDocumentContent(uri: vscode.Uri) {
    const share = this.shares().find((f) => f.id === uri.authority);
    if (!share) throw Error("This shared version was withdrawn or replaced.");
    return share.content;
  }
  async shareActive() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file")
      throw Error("Open the saved file you want to share first.");
    if (editor.document.isDirty)
      throw Error("Save this file before sharing its changes.");
    const root = this.root();
    const file = relative(root, editor.document.uri.fsPath)
      .split("\\")
      .join("/");
    await safeWorkspacePath(root, file);
    const tracked = await git(root, [
      "ls-files",
      "--error-unmatch",
      "--",
      file,
    ]).catch(() => {
      throw Error(
        "File sharing currently supports existing Git-tracked text files.",
      );
    });
    if (!tracked) throw Error("Choose an existing tracked file.");
    const commit = await git(root, ["rev-parse", "HEAD"]);
    const base = await git(root, ["show", `${commit}:${file}`], true);
    const content = editor.document.getText();
    const event = eventSchema.parse({
      type: "file.share",
      file,
      baseCommit: commit,
      baseHash: contentHash(base),
      content,
    });
    if (contentHash(base) === contentHash(content))
      throw Error("This file has no changes from HEAD to share.");
    await this.send(event);
  }
  private get(id: string) {
    const share = this.shares().find((f) => f.id === id);
    if (!share) throw Error("This file version is no longer shared.");
    return share;
  }
  async review(id: string) {
    const share = this.get(id);
    const local = vscode.Uri.file(
      await safeWorkspacePath(this.root(), share.file),
    );
    const doc = await vscode.workspace.openTextDocument(local);
    const remote = vscode.Uri.from({
      scheme: "lattice-shared",
      authority: share.id,
      path: "/" + share.file,
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      local,
      remote,
      `${share.file} · local ↔ shared`,
      { preview: true },
    );
    this.reviewed.set(id, {
      hash: share.hash,
      localHash: contentHash(doc.getText()),
    });
  }
  async apply(id: string) {
    if (!vscode.workspace.isTrusted)
      throw Error("Trust this workspace before applying a shared file.");
    const share = this.get(id);
    const uri = vscode.Uri.file(
      await safeWorkspacePath(this.root(), share.file),
    );
    const disk = await readFile(uri.fsPath, "utf8");
    const doc =
      (await findOpenFileDocument(uri.fsPath, disk)) ||
      (await vscode.workspace.openTextDocument(uri));
    if (!doc.isDirty && doc.getText() !== disk)
      throw Error(
        "The disk changed while the editor was reloading. Review the file again.",
      );
    const reviewed = this.reviewed.get(id);
    if (reviewed && contentHash(doc.getText()) !== reviewed.localHash)
      throw Error(
        "Your file changed since review. Review the diff again before applying.",
      );
    const action = checkFileApply(
      share,
      doc.getText(),
      doc.isDirty,
      reviewed?.hash,
    );
    if (action === "apply") {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length),
        ),
        share.content,
      );
      if (!(await vscode.workspace.applyEdit(edit)))
        throw Error(
          "VS Code could not apply the change. Review your local file and try again.",
        );
      if (!(await doc.save()))
        throw Error(
          "The change is in your editor but could not be saved. Save it manually before continuing.",
        );
    }
    if (contentHash(doc.getText()) !== share.hash)
      throw Error(
        "A save action changed the file after applying it. Review the saved result before sharing it back.",
      );
    await this.send({
      type: "file.receipt",
      id,
      hash: share.hash,
      status: "applied",
    });
  }
}
