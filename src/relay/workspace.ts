import type { Session } from "../shared/protocol";
import {
  workspacePath,
  byteHash,
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_FILE,
  MAX_WORKSPACE_FILES,
  type WorkspaceFile,
} from "../shared/workspace";
export interface WorkspaceRoom {
  session: Session;
  workspaceFiles?: Record<string, WorkspaceFile>;
}
export function putWorkspaceFile(
  room: WorkspaceRoom,
  file: string,
  content: string | null,
  before: string | null,
) {
  if (!workspacePath(file))
    throw Error("This file cannot be shared in a live workspace.");
  const files = (room.workspaceFiles ??= Object.create(null));
  const old = Object.hasOwn(files, file) ? files[file] : undefined;
  const bytes = content === null ? undefined : Buffer.from(content, "base64");
  if (
    bytes &&
    (bytes.length > MAX_WORKSPACE_FILE || bytes.toString("base64") !== content)
  )
    throw Error("Workspace file is invalid or exceeds 512 KiB.");
  const hash = bytes ? byteHash(bytes) : null;
  if ((old?.hash || null) === hash) return false;
  if ((old?.hash || null) !== before)
    throw Error(`Workspace conflict: ${file} changed since your last update.`);
  const summary = (room.session.workspace ??= {
    revision: 0,
    ready: false,
    files: 0,
    bytes: 0,
    skipped: [],
  });
  const nextBytes = summary.bytes - (old?.bytes || 0) + (bytes?.length || 0);
  if (
    nextBytes > MAX_WORKSPACE_BYTES ||
    (!old && bytes && Object.keys(files).length >= MAX_WORKSPACE_FILES)
  )
    throw Error("Live workspace limit reached (2,000 files / 32 MiB).");
  if (bytes)
    Object.defineProperty(files, file, {
      value: { file, hash: hash!, content: content!, bytes: bytes.length },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  else delete files[file];
  summary.bytes = nextBytes;
  summary.files = Object.keys(files).length;
  summary.revision++;
  return true;
}
