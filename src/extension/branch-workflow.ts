import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git";
import type { BranchSession } from "../shared/protocol";
const exec = promisify(execFile);
const identity = [
  "-c",
  "user.name=Lattice Sync",
  "-c",
  "user.email=session@localhost",
  "-c",
  "commit.gpgsign=false",
];
export async function createBranchSession(
  root: string,
  storage: string,
  title: string,
  baseBranch = "main",
) {
  await git(root, ["check-ref-format", "--branch", baseBranch]);
  const remote = await git(root, ["remote", "get-url", "origin"]);
  if (/^https?:\/\/[^/]*@/.test(remote))
    throw Error(
      "Remove embedded credentials from origin before sharing a session. Use your Git credential helper.",
    );
  await git(root, ["fetch", "origin", baseBranch]);
  const baseCommit = await git(root, ["rev-parse", "FETCH_HEAD^{commit}"]);
  const branch = `session/${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "work"
  }-${randomUUID().slice(0, 8)}`;
  const path = join(storage, branch.slice(8));
  await mkdir(storage, { recursive: true });
  await git(root, ["worktree", "add", "-b", branch, path, baseCommit]);
  const lifecycle: BranchSession = {
    baseBranch,
    baseCommit,
    remote,
    status: "active",
  };
  return { path, branch, lifecycle };
}
// A separate index preserves the user's staging area and includes new files.
export async function snapshot(root: string) {
  const directory = await mkdtemp(join(tmpdir(), "lattice-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(directory, "index") };
  const run = async (args: string[]) =>
    (
      await exec("git", args, { cwd: root, env, maxBuffer: 8 * 1024 * 1024 })
    ).stdout.trim();
  try {
    const head = await git(root, ["rev-parse", "HEAD"]);
    await run(["read-tree", head]);
    await run([
      "add",
      "-A",
      "--",
      ".",
      ":(exclude).lattice",
      ":(exclude).lattice/**",
    ]);
    const tree = await run(["write-tree"]);
    const commit = await run([
      ...identity,
      "commit-tree",
      tree,
      "-p",
      head,
      "-m",
      "Lattice Sync recovery checkpoint",
    ]);
    return { head, tree, commit };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function discoverChecks(root: string, configured: string[]) {
  if (configured.length) return [configured];
  const pkg = JSON.parse(
    await readFile(join(root, "package.json"), "utf8").catch(() => "{}"),
  );
  return ["typecheck", "test"]
    .filter(
      (k) => pkg.scripts?.[k] && !pkg.scripts[k].includes("no test specified"),
    )
    .map((k) => ["npm", "run", k]);
}
export async function runChecks(root: string, commands: string[][]) {
  if (!commands.length)
    throw Error(
      "Choose a project check command in Lattice Sync settings before automatic integration.",
    );
  for (const [command, ...args] of commands)
    await exec(command, args, {
      cwd: root,
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
}
export interface Recovery {
  candidate: string;
  checkpoint: string;
  head: string;
  tree: string;
  target: string;
  branch: string;
}
export async function reconcileBranch(options: {
  root: string;
  storage: string;
  branch: string;
  base: string;
  target: string;
  recovery?: Recovery;
  checks: string[][];
  stillSafe: () => boolean | Promise<boolean>;
  resolve?: (path: string, conflicts: string[]) => Promise<void>;
}) {
  const { root, branch, target } = options;
  if ((await git(root, ["branch", "--show-current"])) !== branch)
    throw Error("The session branch changed. Return to its branch to resume.");
  if (!(await options.stillSafe()))
    throw Error(
      "Waiting for active work and unsaved editors to reach a safe checkpoint.",
    );
  const current = await snapshot(root);
  const recovery = options.recovery;
  if (
    recovery &&
    (recovery.target !== target ||
      recovery.branch !== branch ||
      recovery.head !== current.head ||
      recovery.tree !== current.tree)
  )
    throw Error(
      "Work or the base branch changed since this candidate was prepared. Start a fresh update; the old candidate is preserved.",
    );
  const before = recovery
    ? { ...current, commit: recovery.checkpoint }
    : current;
  const id = randomUUID();
  const candidate = recovery?.candidate || join(options.storage, id);
  if (!recovery) {
    await git(root, [
      "update-ref",
      `refs/lattice/checkpoints/${id}`,
      before.commit,
    ]);
    await mkdir(options.storage, { recursive: true });
    await git(root, ["worktree", "add", "--detach", candidate, before.commit]);
  }
  try {
    if (!recovery) {
      try {
        await git(candidate, [
          ...identity,
          "merge",
          "--no-edit",
          "--no-commit",
          target,
        ]);
      } catch (e) {
        if (!(await git(candidate, ["diff", "--name-only", "--diff-filter=U"])))
          throw e;
      }
    }
    const conflicts = (
      await git(candidate, ["diff", "--name-only", "--diff-filter=U"])
    )
      .split("\n")
      .filter(Boolean);
    if (conflicts.length) {
      await options.resolve?.(candidate, conflicts);
      if (await git(candidate, ["diff", "--name-only", "--diff-filter=U"]))
        throw Error(
          `Unresolved conflicts remain. Candidate preserved at ${candidate}`,
        );
    }
    if (
      (await git(candidate, ["status", "--porcelain"])) ||
      (await git(candidate, [
        "rev-parse",
        "-q",
        "--verify",
        "MERGE_HEAD",
      ]).catch(() => ""))
    ) {
      await git(candidate, ["add", "-A"]);
      await git(candidate, [
        ...identity,
        "commit",
        "--allow-empty",
        "-m",
        "Reconcile session with updated base",
      ]);
    }
    if (await stat(join(root, "node_modules")).catch(() => undefined))
      await symlink(
        join(root, "node_modules"),
        join(candidate, "node_modules"),
        "dir",
      ).catch(() => {});
    await runChecks(candidate, options.checks);
    if (await git(candidate, ["status", "--porcelain"]))
      throw Error(
        `Checks changed candidate files; review ${candidate} before integration.`,
      );
    const result = await git(candidate, ["rev-parse", "HEAD"]);
    await git(candidate, [
      "merge-base",
      "--is-ancestor",
      before.commit,
      result,
    ]);
    await git(candidate, ["merge-base", "--is-ancestor", target, result]);
    const now = await snapshot(root);
    if (
      now.head !== before.head ||
      now.tree !== before.tree ||
      !(await options.stillSafe()) ||
      (await git(root, ["branch", "--show-current"])) !== branch
    )
      throw Error(
        `Work changed during reconciliation. It was preserved; verified candidate is at ${candidate}.`,
      );
    // Checkpointing makes existing work committed without overwriting any files.
    await git(root, [
      "update-ref",
      `refs/heads/${branch}`,
      before.commit,
      before.head,
    ]);
    await git(root, ["reset", "--mixed", before.commit]);
    await git(root, ["merge", "--ff-only", result]);
    await git(root, ["worktree", "remove", candidate]);
    return { commit: result, base: target, checkpoint: before.commit };
  } catch (e: any) {
    throw Object.assign(
      Error(
        `${e.message}\nRecovery checkpoint: ${before.commit}\nCandidate: ${candidate}`,
      ),
      {
        recovery: {
          candidate,
          checkpoint: before.commit,
          head: before.head,
          tree: before.tree,
          target,
          branch,
        } satisfies Recovery,
      },
    );
  }
}
export async function github(root: string, args: string[]) {
  return (
    await exec("gh", args, {
      cwd: root,
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    })
  ).stdout.trim();
}
export async function pullRequest(
  root: string,
  branch: string,
  number?: number,
) {
  if (number)
    return JSON.parse(
      await github(root, [
        "pr",
        "view",
        String(number),
        "--json",
        "number,url,state,headRefOid,baseRefName",
      ]),
    );
  const prs = JSON.parse(
    await github(root, [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      "number,url,state,headRefOid,baseRefName",
      "--limit",
      "20",
    ]),
  );
  return prs[0] as
    | {
        number: number;
        url: string;
        state: string;
        headRefOid: string;
        baseRefName: string;
      }
    | undefined;
}
export async function publishPullRequest(
  root: string,
  branch: string,
  base: string,
  title: string,
  body: string,
  reviewed?: { head: string; tree: string },
) {
  if ((await git(root, ["branch", "--show-current"])) !== branch)
    throw Error("Return to the session branch before publishing.");
  const before = await snapshot(root);
  if (
    reviewed &&
    (before.head !== reviewed.head || before.tree !== reviewed.tree)
  )
    throw Error("Files changed after review. Prepare the PR again.");
  if (await git(root, ["status", "--porcelain"])) {
    await git(root, [
      "add",
      "--all",
      "--",
      ".",
      ":(exclude).lattice",
      ":(exclude).lattice/**",
    ]);
    if ((await git(root, ["write-tree"])) !== before.tree)
      throw Error(
        "Files changed while staging. Review the changes before publishing.",
      );
    await git(root, ["commit", "-m", title]);
  }
  const commit = await git(root, ["rev-parse", "HEAD"]);
  if ((await git(root, ["rev-parse", "HEAD^{tree}"])) !== before.tree)
    throw Error(
      "The commit differs from the reviewed files. Review it before publishing.",
    );
  await git(root, ["push", "origin", `${commit}:refs/heads/${branch}`]);
  const existing = await pullRequest(root, branch);
  if (existing?.state === "OPEN") {
    if (existing.headRefOid !== commit || existing.baseRefName !== base)
      throw Error(
        "The existing PR changed. Inspect it on GitHub before continuing.",
      );
    return existing;
  }
  const directory = await mkdtemp(join(tmpdir(), "lattice-pr-"));
  try {
    const path = join(directory, "body.md");
    await writeFile(path, body);
    try {
      await github(root, [
        "pr",
        "create",
        "--head",
        branch,
        "--base",
        base,
        "--title",
        title,
        "--body-file",
        path,
      ]);
    } catch {
      const observed = await pullRequest(root, branch).catch(() => undefined);
      if (
        observed?.state === "OPEN" &&
        observed.headRefOid === commit &&
        observed.baseRefName === base
      )
        return observed;
      throw Error(
        "PR creation outcome is unknown. The branch was pushed. Inspect GitHub before retrying; an existing PR will be reused.",
      );
    }
    const created = await pullRequest(root, branch);
    if (
      !created ||
      created.state !== "OPEN" ||
      created.headRefOid !== commit ||
      created.baseRefName !== base
    )
      throw Error(
        "PR creation outcome is unknown. Check GitHub before retrying.",
      );
    return created;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
