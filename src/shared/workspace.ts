import { createHash } from "node:crypto";
export const MAX_WORKSPACE_FILE = 512 * 1024;
export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
export const MAX_WORKSPACE_FILES = 2000;
export interface WorkspaceFile {
  file: string;
  hash: string;
  bytes: number;
  content: string;
}
export interface WorkspaceSummary {
  revision: number;
  ready: boolean;
  files: number;
  bytes: number;
  skipped: string[];
}
export const byteHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export function workspacePath(file: string) {
  return (
    !!file &&
    file.length <= 500 &&
    !/[\\\0:]/.test(file) &&
    !file.split("/").some((p) => !p || p === "." || p === "..") &&
    !/(^|\/)(?:\.git|\.vscode|\.idea|\.codex|\.claude|\.[^/]+|\.ssh|\.aws|\.azure|\.config|\.venv|venv|node_modules|dist|build|\.next|\.cache|coverage|\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|\.DS_Store)(\/|$)/i.test(
      file,
    ) &&
    !/(?:\.(?:pem|key|p12|pfx|keystore|vsix)|(?:^|\/)(?:id_rsa|id_ed25519|credentials)(?:\.[^/]*)?)$/i.test(
      file,
    )
  );
}
