import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
const exec = promisify(execFile);
export async function git(cwd: string, args: string[], raw = false) {
  const { stdout } = await exec("git", args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
  });
  return raw ? stdout : stdout.trimEnd();
}
export async function gitFacts(cwd: string) {
  let branch = "",
    repo = cwd.split("/").pop() || "Workspace";
  try {
    branch = await git(cwd, ["branch", "--show-current"]);
  } catch {}
  try {
    repo = (await git(cwd, ["remote", "get-url", "origin"])).replace(
      /(https?:\/\/)[^/@]+@/,
      "$1",
    );
  } catch {}
  return { branch, repo };
}
export interface TaskTree {
  id: string;
  path: string;
  branch: string;
  base: string;
  status: string;
}
export async function createTaskTree(
  cwd: string,
  storage: string,
  id: string,
): Promise<TaskTree> {
  await mkdir(storage, { recursive: true });
  const branch = `lattice/task-${id.slice(0, 8)}`,
    path = join(storage, id);
  const base = await git(cwd, ["rev-parse", "HEAD"]);
  await git(cwd, ["worktree", "add", "-b", branch, path, base]);
  return { id, path, branch, base, status: "ready" };
}
export async function taskPatch(tree: TaskTree) {
  await git(tree.path, ["add", "--intent-to-add", "."]);
  return git(tree.path, ["diff", "--binary", tree.base, "--", "."], true);
}
export async function integrateTask(
  cwd: string,
  tree: TaskTree,
  patch: string,
) {
  if (await git(cwd, ["status", "--porcelain"]))
    throw Error(
      "Commit or stash your local changes before integrating this task.",
    );
  if (!patch.trim()) throw Error("This task has no changes to integrate.");
  await new Promise<void>((resolve, reject) => {
    const p = execFile("git", ["apply", "--check", "-"], { cwd }, (e) =>
      e ? reject(e) : resolve(),
    );
    p.stdin?.end(patch);
  });
  await new Promise<void>((resolve, reject) => {
    const p = execFile("git", ["apply", "-"], { cwd }, (e) =>
      e ? reject(e) : resolve(),
    );
    p.stdin?.end(patch);
  });
  tree.status = "integrated";
}
export async function safeWorkspacePath(root: string, file: string) {
  const full = join(root, file);
  const resolved = await realpath(full);
  const rel = relative(await realpath(root), resolved);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw Error("File is outside the workspace.");
  return resolved;
}
