import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
/** Prefer any dirty buffer for the same physical file, including symlink aliases. */
export async function findOpenFileDocument(
  full: string,
  expectedContent?: string,
) {
  const canonical = await realpath(full).catch(() => full);
  const matches = await Promise.all(
    vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === "file")
      .map(async (doc) => ({
        doc,
        path: await realpath(doc.uri.fsPath).catch(() => doc.uri.fsPath),
      })),
  );
  const same = matches
    .filter((m) => m.path === canonical || m.doc.uri.fsPath === full)
    .map((m) => m.doc);
  return (
    same.find((d) => d.isDirty) ||
    (expectedContent === undefined
      ? undefined
      : same.find((d) => d.getText() === expectedContent)) ||
    same.find((d) => d.uri.fsPath === full) ||
    same[0]
  );
}
