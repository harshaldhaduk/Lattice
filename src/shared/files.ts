import { createHash } from "node:crypto";
import type { FileShare } from "./protocol";
export function contentHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
export function checkFileApply(
  share: FileShare,
  local: string,
  dirty: boolean,
  reviewedHash?: string,
) {
  if (dirty)
    throw Error(
      "Save or undo your local edits before applying a shared change.",
    );
  if (reviewedHash !== share.hash)
    throw Error("Review this exact file version before applying it.");
  if (contentHash(share.content) !== share.hash)
    throw Error("Shared file content does not match its checksum.");
  const localHash = contentHash(local);
  if (localHash === share.hash) return "unchanged" as const;
  if (localHash !== share.baseHash)
    throw Error(
      "Your file differs from the shared base. Review the diff and merge the changes manually; your local file was left untouched.",
    );
  return "apply" as const;
}
