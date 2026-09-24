import { existsSync } from "node:fs";
import { realpath, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative, resolve, isAbsolute } from "node:path";
import { git } from "./git";
import { snapshot } from "./branch-workflow";

export type SessionCleanup = {
  room: string;
  path: string;
  project: string;
  branch: string;
  head: string;
  tree: string;
  status: string;
  diskState: string;
};
// Include ignored files (e.g. local .env files) in the post-confirmation guard
// without reading dependency/build trees into memory or following symlinks.
async function diskState(root: string) {
  const hash = createHash("sha256");
  async function walk(directory: string) {
    for (const name of (await readdir(directory)).sort()) {
      if (name === ".git") continue;
      const path = resolve(directory, name),
        info = await lstat(path);
      hash.update(
        JSON.stringify([
          relative(root, path),
          info.mode,
          info.size,
          info.mtimeMs,
          info.ctimeMs,
        ]),
      );
      if (info.isDirectory()) await walk(path);
    }
  }
  await walk(root);
  return hash.digest("hex");
}
export async function originalProject(root: string) {
  const list = await git(root, ["worktree", "list", "--porcelain", "-z"]);
  return list
    .split("\0")
    .find((line) => line.startsWith("worktree "))
    ?.slice(9);
}
async function validateTarget(
  job: Pick<SessionCleanup, "path" | "project" | "branch">,
  storage: string,
) {
  const path = await realpath(job.path),
    base = await realpath(storage),
    project = await realpath(job.project);
  const inside = relative(base, path);
  if (
    !inside ||
    inside.startsWith("..") ||
    isAbsolute(inside) ||
    path === project ||
    !job.branch.startsWith("session/")
  )
    throw Error("Only Lattice-managed session branches can be discarded here.");
  const common = async (root: string) =>
    realpath(resolve(root, await git(root, ["rev-parse", "--git-common-dir"])));
  if ((await common(path)) !== (await common(project)))
    throw Error("This session belongs to a different repository.");
  if ((await git(path, ["branch", "--show-current"])) !== job.branch)
    throw Error("The session branch changed. Nothing was deleted.");
  const entries = (
    await git(project, ["worktree", "list", "--porcelain", "-z"])
  ).split("\0\0");
  const matches = entries.filter((entry) =>
    entry.split("\0").includes(`branch refs/heads/${job.branch}`),
  );
  if (
    matches.length !== 1 ||
    !matches[0].split("\0").some((line) => line === `worktree ${path}`)
  )
    throw Error(
      "The branch's worktree registration changed. Nothing was deleted.",
    );
}
export async function prepareCleanup(
  room: string,
  path: string,
  project: string,
  branch: string,
  storage: string,
): Promise<SessionCleanup> {
  await validateTarget({ path, project, branch }, storage);
  const { head, tree } = await snapshot(path);
  return {
    room,
    path,
    project,
    branch,
    head,
    tree,
    diskState: await diskState(path),
    status: await git(path, ["status", "--porcelain", "--untracked-files=all"]),
  };
}
export async function cleanupSession(job: SessionCleanup, storage: string) {
  if (existsSync(job.path)) {
    await validateTarget(job, storage);
    const now = await snapshot(job.path);
    if (
      (await diskState(job.path)) !== job.diskState ||
      now.head !== job.head ||
      now.tree !== job.tree ||
      job.status !==
        (await git(job.path, [
          "status",
          "--porcelain",
          "--untracked-files=all",
        ]))
    )
      throw Error(
        "Session files changed after you confirmed discard. They have been kept; reopen the session to review them.",
      );
    await git(job.project, ["worktree", "remove", "--force", job.path]);
  }
  const ref = `refs/heads/${job.branch}`;
  const head = await git(job.project, ["rev-parse", "--verify", ref]).catch(
    () => undefined,
  );
  if (!head) return;
  if (head !== job.head)
    throw Error(
      "The branch moved after discard was confirmed. The branch has been kept.",
    );
  const worktrees = await git(job.project, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  if (worktrees.split("\0").includes(`branch ${ref}`))
    throw Error("The branch is open in another worktree and has been kept.");
  // Compare-and-delete: a concurrent commit must never be deleted.
  await git(job.project, ["update-ref", "-d", ref, job.head]);
}
