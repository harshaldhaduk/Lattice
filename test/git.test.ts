import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  git,
  gitFacts,
  createTaskTree,
  taskPatch,
  integrateTask,
  safeWorkspacePath,
} from "../src/extension/git";
test("worktree changes including new files apply cleanly and preserve dirty checkouts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lattice-git-"));
  const repo = join(dir, "repo");
  await mkdir(repo);
  try {
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.invalid"]);
    await git(repo, ["config", "user.name", "Test"]);
    await writeFile(join(repo, "app.txt"), "before\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "Initial"]);
    assert.equal((await gitFacts(repo)).branch, "main");
    const tree = await createTaskTree(
      repo,
      join(dir, "trees"),
      "12345678-task",
    );
    await writeFile(join(tree.path, "app.txt"), "after\n");
    await writeFile(join(tree.path, "new.txt"), "new file\n");
    const patch = await taskPatch(tree);
    assert.ok(patch.endsWith("\n"));
    assert.match(patch, /new file/);
    await writeFile(join(repo, "dirty.txt"), "keep");
    await assert.rejects(integrateTask(repo, tree, patch), /Commit or stash/);
    assert.equal(await readFile(join(repo, "app.txt"), "utf8"), "before\n");
    await rm(join(repo, "dirty.txt"));
    await integrateTask(repo, tree, patch);
    assert.equal(await readFile(join(repo, "app.txt"), "utf8"), "after\n");
    assert.equal(await readFile(join(repo, "new.txt"), "utf8"), "new file\n");
    assert.equal(tree.status, "integrated");
    await symlink(dir, join(repo, "escape"));
    await assert.rejects(safeWorkspacePath(repo, "escape"), /outside/);
    assert.equal(
      await safeWorkspacePath(repo, "app.txt"),
      await import("node:fs/promises").then((fs) =>
        fs.realpath(join(repo, "app.txt")),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
