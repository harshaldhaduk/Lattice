import * as vscode from "vscode";
import * as Y from "yjs";
import { diffChars } from "diff";
import {
  textDocument,
  encodeDocument,
  replaceText,
} from "../shared/collaboration";
import { contentHash } from "../shared/files";
import { sourceFile } from "../shared/live-files";
import { SessionClient } from "../shared/client";
import { git, safeWorkspacePath } from "./git";

interface Binding {
  uri: vscode.Uri;
  file: string;
  seed: string;
  local: Y.Doc;
  pending: boolean;
  timer?: NodeJS.Timeout;
  rendering: boolean;
  expected?: { content: string; document: Y.Doc };
  version: number;
}
export class SharedEditor implements vscode.Disposable {
  private bindings = new Map<string, Binding>();
  private subscription: vscode.Disposable;
  private fileSubscriptions: vscode.Disposable[] = [];
  private room = "";
  constructor(
    private client: SessionClient,
    private context: vscode.ExtensionContext,
    private changed: () => void,
    private notice: (text: string) => void,
  ) {
    this.subscription = vscode.workspace.onDidChangeTextDocument((e) => {
      const binding = [...this.bindings.values()].find(
        (b) => b.uri.toString() === e.document.uri.toString(),
      );
      if (!binding || !e.contentChanges.length) return;
      const content = e.document.getText();
      if (binding.expected?.content === content) {
        binding.local.destroy();
        binding.local = binding.expected.document;
        binding.expected = undefined;
        return;
      }
      try {
        replaceText(binding.local, content);
        binding.pending = true;
        this.schedule(binding);
      } catch (e: any) {
        this.notice(e.message);
      }
    });
    const release = (uri: vscode.Uri) => {
      for (const [file, binding] of this.bindings) {
        if (binding.uri.toString() !== uri.toString()) continue;
        clearTimeout(binding.timer);
        binding.local.destroy();
        this.bindings.delete(file);
        this.changed();
      }
    };
    this.fileSubscriptions.push(
      vscode.workspace.onDidRenameFiles((e) => {
        for (const file of e.files) release(file.oldUri);
      }),
      vscode.workspace.onDidDeleteFiles((e) => {
        for (const file of e.files) release(file);
      }),
    );
  }
  get files() {
    return [...this.bindings.keys()];
  }
  has(file: string) {
    return this.bindings.has(file);
  }
  async shareCurrent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file")
      throw Error("Open a source file first.");
    if (!this.client.connected) throw Error("Join a session first.");
    const person = this.client.session?.people.find(
      (p) => p.id === this.client.credentials?.personId,
    );
    if (!person || person.role === "viewer")
      throw Error("Editor access is required.");
    const file = vscode.workspace.asRelativePath(editor.document.uri, false);
    if (
      !vscode.workspace.getWorkspaceFolder(editor.document.uri) ||
      !sourceFile(file)
    )
      throw Error("Choose a source file inside this workspace.");
    const root = vscode.workspace.getWorkspaceFolder(editor.document.uri)!.uri
      .fsPath;
    await safeWorkspacePath(root, file);
    if (
      await git(root, ["check-ignore", "--", file]).then(
        () => true,
        () => false,
      )
    )
      throw Error("Git-ignored files are excluded from collaborative editing.");
    await this.attach(editor.document.uri, file);
    vscode.window.showInformationMessage(
      `Collaborative editing enabled for ${file}. Teammates can enable it on the same file. Edits stay in the normal editor undo history.`,
    );
  }
  async attach(uri: vscode.Uri, file: string) {
    const document = await vscode.workspace.openTextDocument(uri);
    if (this.bindings.has(file)) return;
    if (document.isDirty)
      throw Error(
        "Save your existing edits before enabling collaborative editing for this file.",
      );
    const content = document.getText();
    if (content.length > 32000)
      throw Error("Collaborative files are limited to 32,000 characters.");
    const shared = this.client.session?.documents?.find(
      (d) => d.key === "main:" + file,
    );
    if (shared && shared.content !== content)
      throw Error(
        "Resolve the live-file difference before enabling collaboration.",
      );
    const local = textDocument(content, shared?.crdtState);
    const binding: Binding = {
      uri,
      file,
      seed: shared?.crdtBaseContent ?? content,
      local,
      pending: true,
      rendering: false,
      version: shared?.version || 0,
    };
    this.bindings.set(file, binding);
    this.room = this.client.session!.id;
    await this.publish(binding);
    this.changed();
  }
  private schedule(binding: Binding) {
    clearTimeout(binding.timer);
    binding.timer = setTimeout(
      () => void this.publish(binding).catch((e) => this.notice(e.message)),
      60,
    );
    void this.context.secrets.store(
      `collaboration:${this.room}:${binding.file}`,
      JSON.stringify({
        seed: binding.seed,
        state: encodeDocument(binding.local),
      }),
    );
  }
  private async publish(binding: Binding) {
    if (
      this.bindings.get(binding.file) !== binding ||
      !binding.pending ||
      !this.client.connected ||
      !vscode.workspace.getConfiguration("lattice").get("liveSync", true)
    )
      return;
    const state = encodeDocument(binding.local);
    const content = binding.local.getText("source").toString();
    const me = this.client.credentials!.personId;
    await this.client.event({
      type: "document.update",
      human: true,
      isolated: false,
      file: binding.file,
      runId: "human:" + me,
      beforeHash: contentHash(content),
      baseMissing: false,
      content,
      line: 0,
      column: 0,
      collaboration: {
        base: binding.seed,
        baseHash: contentHash(binding.seed),
        update: state,
      },
    });
    if (encodeDocument(binding.local) === state) {
      binding.pending = false;
      await this.context.secrets.delete(
        `collaboration:${this.room}:${binding.file}`,
      );
    }
  }
  onState() {
    if (this.client.session?.id !== this.room && this.bindings.size) {
      this.clear();
      return;
    }
    if (
      this.client.session?.people.find(
        (p) => p.id === this.client.credentials?.personId,
      )?.role === "viewer"
    ) {
      this.clear();
      return;
    }
    if (!vscode.workspace.getConfiguration("lattice").get("liveSync", true))
      return;
    for (const binding of this.bindings.values()) {
      if (binding.pending && this.client.connected) this.schedule(binding);
      void this.render(binding).catch((e) => this.notice(e.message));
    }
  }
  private async render(binding: Binding) {
    if (binding.rendering) return;
    const shared = this.client.session?.documents?.find(
      (d) => d.key === "main:" + binding.file,
    );
    if (!shared?.crdtState || shared.version <= binding.version) return;
    binding.rendering = true;
    try {
      const editor = await vscode.workspace.openTextDocument(binding.uri);
      if (
        this.bindings.get(binding.file) !== binding ||
        this.client.session?.id !== this.room
      )
        return;
      const merged = textDocument("", encodeDocument(binding.local));
      Y.applyUpdate(merged, Buffer.from(shared.crdtState, "base64"));
      const next = merged.getText("source").toString(),
        before = editor.getText();
      if (before !== binding.local.getText("source").toString()) {
        merged.destroy();
        throw Error(
          "The collaborative buffer changed unexpectedly. Reopen collaboration before continuing.",
        );
      }
      if (next !== before) {
        const changes = diffChars(before, next, { timeout: 1000 });
        if (!changes) {
          merged.destroy();
          throw Error("Remote edit is too large.");
        }
        const edit = new vscode.WorkspaceEdit();
        let offset = 0;
        for (const c of changes) {
          if (c.added)
            edit.insert(binding.uri, editor.positionAt(offset), c.value);
          else if (c.removed) {
            edit.delete(
              binding.uri,
              new vscode.Range(
                editor.positionAt(offset),
                editor.positionAt(offset + c.value.length),
              ),
            );
            offset += c.value.length;
          } else offset += c.value.length;
        }
        binding.expected = { content: next, document: merged };
        if (!(await vscode.workspace.applyEdit(edit)))
          throw Error("The collaborative editor could not apply an update.");
        if (binding.expected) {
          binding.expected.document.destroy();
          binding.expected = undefined;
          return;
        }
      } else {
        binding.local.destroy();
        binding.local = merged;
      }
      binding.version = shared.version;
    } finally {
      binding.rendering = false;
      const latest = this.client.session?.documents?.find(
        (d) => d.key === "main:" + binding.file,
      );
      if (latest && latest.version > shared.version)
        void this.render(binding).catch((e) => this.notice(e.message));
    }
  }
  async recoverCurrent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.client.session)
      throw Error("Open the file in its original session first.");
    const file = vscode.workspace.asRelativePath(editor.document.uri, false);
    const saved = await this.context.secrets.get(
      `collaboration:${this.client.session.id}:${file}`,
    );
    if (!saved) throw Error("No pending edits were saved for this file.");
    const data = JSON.parse(saved);
    const document = textDocument("", data.state);
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument({
          content: document.getText("source").toString(),
          language: editor.document.languageId,
        }),
      );
    } finally {
      document.destroy();
    }
  }
  clear() {
    for (const binding of this.bindings.values()) {
      clearTimeout(binding.timer);
      binding.local.destroy();
    }
    this.bindings.clear();
    this.changed();
  }
  dispose() {
    this.subscription.dispose();
    for (const subscription of this.fileSubscriptions) subscription.dispose();
    this.clear();
  }
}
