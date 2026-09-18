import { contentHash } from "./files";
import type { LiveDocument } from "./protocol";
export function changedCursor(before: string, after: string) {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const offset = Math.max(start, after.length - tail);
  const lines = after.slice(0, offset).split("\n");
  return { line: lines.length - 1, column: lines.at(-1)!.length };
}
export function canSyncDocument(
  doc: LiveDocument,
  local: string | undefined,
  dirty: boolean,
  lastApplied?: string,
) {
  if (dirty) return { ok: false, reason: "Unsaved local edits" };
  if (local === undefined)
    return doc.baseMissing
      ? { ok: true }
      : { ok: false, reason: "The local file is missing" };
  const hash = contentHash(local);
  if (hash === doc.hash) return { ok: true, unchanged: true };
  if (
    hash === doc.baseHash ||
    hash === doc.previousHash ||
    hash === lastApplied
  )
    return { ok: true };
  return { ok: false, reason: "Local changes overlap with the live version" };
}
export function sourceFile(file: string) {
  return (
    !/(^|\/)(\.git|\.vscode|\.codex|\.claude|\.[^/]+|node_modules|\.env(?:\.[^/]*)?|\.ssh|dist|build)(\/|$)/.test(
      file,
    ) &&
    /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|c|cpp|h|hpp|cs|rb|php|sh|sql|md|mdx|json|ya?ml|toml|css|scss|html|vue|svelte)$/.test(
      file,
    )
  );
}
