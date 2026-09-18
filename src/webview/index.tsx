import { Dashboard } from "./Dashboard";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LiveEditor } from "./LiveEditor";
import type { AppState } from "../shared/protocol";
import "./styles.css";
declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (m: any) => void;
      getState: () => any;
      setState: (s: any) => void;
    };
    LATTICE_STORAGE?: { getState: () => any; setState: (s: any) => void };
    LATTICE_MODE?: "sidebar" | "composer" | "preview" | "live" | "dashboard";
    LATTICE_PREVIEW?: AppState;
  }
}
const vscode = window.acquireVsCodeApi?.();
window.LATTICE_STORAGE = vscode;
const root = createRoot(document.getElementById("root")!);
let state: AppState = window.LATTICE_PREVIEW || {
  me: "",
  connected: false,
  providers: [],
  repo: "",
  branch: "",
};
const post = (m: any) => {
  if (vscode) vscode.postMessage(m);
  else window.dispatchEvent(new CustomEvent("previewAction", { detail: m }));
};
const render = () =>
  root.render(
    window.LATTICE_MODE === "dashboard" ? (
      <Dashboard state={state} post={post} />
    ) : window.LATTICE_MODE === "live" ? (
      <LiveEditor state={state} post={post} />
    ) : (
      <App state={state} mode={window.LATTICE_MODE || "sidebar"} post={post} />
    ),
  );
window.addEventListener("message", (e) => {
  if (e.data.type === "state") {
    state = e.data.state;
    render();
  }
});
render();
post({ type: "ready" });
