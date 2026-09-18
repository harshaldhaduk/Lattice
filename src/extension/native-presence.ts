import * as vscode from "vscode";
import { performance } from "node:perf_hooks";
import { PresenceAvatars } from "./avatars";
import { PresenceMotion } from "./presence-motion";
import type { AppState, Person } from "../shared/protocol";
import { initials } from "../shared/protocol";

export function presenceLocation(state: AppState, person: Person) {
  const doc =
    person.agent?.status === "running"
      ? state.session?.documents
          ?.filter(
            (d) =>
              d.author === person.id &&
              d.runId === person.agent?.runId &&
              !d.isolated,
          )
          .sort((a, b) => b.updated - a.updated)[0]
      : undefined;
  return doc
    ? { file: doc.file, line: doc.line, column: doc.column, working: true }
    : {
        file: person.file,
        line: person.line,
        column: person.column,
        working: false,
      };
}

interface Marker {
  type: vscode.TextEditorDecorationType;
  signature: string;
  file: string;
  motion: PresenceMotion;
  hover: string;
  rendered?: string;
}

/** Reuses native decoration types; only sends positions while a marker moves. */
export class NativePresence implements vscode.Disposable {
  private editors = new Map<vscode.TextEditor, Map<string, Marker>>();
  private avatars: PresenceAvatars;
  private subscriptions: vscode.Disposable[];
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private state: () => AppState,
    directory: string,
  ) {
    this.avatars = new PresenceAvatars(directory, () => this.refresh());
    this.subscriptions = [
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        for (const marker of this.editors.get(e.textEditor)?.values() || [])
          marker.rendered = undefined;
        this.refresh();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const [editor, markers] of this.editors) {
          if (editor.document !== e.document) continue;
          // VS Code may have tracked an old decoration through the edit.
          for (const marker of markers.values()) marker.rendered = undefined;
        }
        this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("lattice.animatePresence") ||
          e.affectsConfiguration("workbench.reduceMotion") ||
          e.affectsConfiguration("editor.fontSize")
        )
          this.refresh();
      }),
    ];
  }

  refresh() {
    if (this.disposed) return;
    const state = this.state();
    const now = performance.now();
    const visible = new Set(vscode.window.visibleTextEditors);
    const animate =
      vscode.workspace
        .getConfiguration("lattice")
        .get("animatePresence", true) &&
      vscode.workspace.getConfiguration("workbench").get("reduceMotion") !==
        "on";
    for (const [editor, markers] of this.editors) {
      if (visible.has(editor)) continue;
      for (const marker of markers.values()) marker.type.dispose();
      this.editors.delete(editor);
    }
    for (const editor of visible) {
      const file = vscode.workspace.asRelativePath(editor.document.uri, false);
      const markers = this.editors.get(editor) || new Map<string, Marker>();
      this.editors.set(editor, markers);
      const active = new Set<string>();
      for (const person of state.connected ? state.session?.people || [] : []) {
        if (!person.online || person.id === state.me) continue;
        const location = presenceLocation(state, person);
        if (
          !location.file ||
          location.file !== file ||
          editor.document.uri.scheme !== "file"
        )
          continue;
        active.add(person.id);
        const line = Math.max(
          0,
          Math.min(location.line || 0, editor.document.lineCount - 1),
        );
        const column = Math.max(
          0,
          Math.min(
            location.column ?? editor.document.lineAt(line).text.length,
            editor.document.lineAt(line).text.length,
          ),
        );
        const fontSize = vscode.workspace
          .getConfiguration("editor", editor.document.uri)
          .get<number>("fontSize", 14);
        const size = Math.max(6, Math.min(16, Math.floor(fontSize * 0.8)));
        const icon = this.avatars.get(person, size);
        const signature = JSON.stringify([
          person.name,
          person.color,
          icon?.toString(),
          size,
        ]);
        const hover = location.working
          ? `${person.name}’s agent is editing ${file}`
          : `${person.name} is viewing ${file}`;
        let marker = markers.get(person.id);
        if (
          marker &&
          (marker.signature !== signature || marker.file !== file)
        ) {
          marker.type.dispose();
          markers.delete(person.id);
          marker = undefined;
        }
        if (!marker) {
          marker = {
            signature,
            file,
            hover,
            motion: new PresenceMotion({ line, column }),
            type: vscode.window.createTextEditorDecorationType({
              rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
              after: {
                ...(icon
                  ? { contentIconPath: icon }
                  : {
                      contentText: initials(person.name),
                      color: person.color,
                    }),
                width: `${size}px`,
                height: `${size}px`,
                // Reserve no horizontal space: remote movement must not push code around.
                margin: `0 -${size + 8}px 0 8px`,
              },
              overviewRulerColor: person.color,
              overviewRulerLane: vscode.OverviewRulerLane.Right,
            }),
          };
          markers.set(person.id, marker);
        }
        marker.hover = hover;
        marker.motion.move({ line, column }, now, animate);
      }
      for (const [id, marker] of markers) {
        if (active.has(id)) continue;
        marker.type.dispose();
        markers.delete(id);
      }
    }
    this.draw();
  }

  private draw = () => {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const now = performance.now();
    let moving = false;
    for (const [editor, markers] of this.editors) {
      for (const marker of markers.values()) {
        const point = marker.motion.sample(now);
        const line = Math.max(
          0,
          Math.min(point.line, editor.document.lineCount - 1),
        );
        const column = Math.max(
          0,
          Math.min(point.column, editor.document.lineAt(line).text.length),
        );
        const key = `${line}:${column}:${marker.hover}`;
        if (marker.rendered !== key) {
          editor.setDecorations(marker.type, [
            {
              range: new vscode.Range(line, column, line, column),
              hoverMessage: marker.hover,
            },
          ]);
          marker.rendered = key;
        }
        moving ||= marker.motion.moving(now);
      }
    }
    if (moving) this.timer = setTimeout(this.draw, 16);
  };

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.avatars.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const markers of this.editors.values())
      for (const marker of markers.values()) marker.type.dispose();
    this.editors.clear();
  }
}
