import * as vscode from "vscode";
import { originalProject } from "./session-cleanup";

export async function saveBeforeSwitch() {
  if (!vscode.workspace.textDocuments.some((doc) => doc.isDirty)) return true;
  const choice = await vscode.window.showWarningMessage(
    "Save your open edits before switching workspaces?",
    { modal: true },
    "Save and continue",
  );
  return (
    choice === "Save and continue" && (await vscode.workspace.saveAll(true))
  );
}
export async function rememberProject(
  context: vscode.ExtensionContext,
  target: string,
) {
  const current = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (
    !current ||
    current === target ||
    context.globalState.get<string>(`returnProject:${target}`)
  )
    return;
  const project =
    context.globalState.get<string>(`returnProject:${current}`) ||
    (await originalProject(current).catch(() => undefined)) ||
    current;
  if (project !== target)
    await context.globalState.update(`returnProject:${target}`, project);
}
export async function openInSameWindow(path: string) {
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(path),
    { forceReuseWindow: true },
  );
}
