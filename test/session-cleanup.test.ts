import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/extension/git";
import {
  prepareCleanup,
  cleanupSession,
  originalProject,
} from "../src/extension/session-cleanup";

test("discard only removes the reviewed managed branch; preserves main and rejects late edits", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "lattice-cleanup-"));
  const project = join(scratch, "project"),
    storage = join(scratch, "sessions"),
    path = join(storage, "feature");
  try {
    await mkdir(project);
    await mkdir(storage);
    await git(project, ["init", "-b", "main"]);
    await git(project, ["config", "user.name", "Test"]);
    await git(project, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(project, "source.txt"), "original\n");
    await git(project, ["add", "."]);
    await git(project, ["commit", "-m", "Base"]);
    const main = await git(project, ["rev-parse", "main"]);
    await git(project, ["worktree", "add", "-b", "session/feature", path]);
    // macOS realpath normalizes /var to /private/var.
    assert.match((await originalProject(path))!, /\/project$/);
    await writeFile(join(path, "source.txt"), "reviewed edit\n");
    const job = await prepareCleanup(
      "room",
      path,
      project,
      "session/feature",
      storage,
    );
    await writeFile(join(path, "new.txt"), "late change\n");
    await assert.rejects(cleanupSession(job, storage), /changed after/);
    assert.equal(
      await readFile(join(path, "new.txt"), "utf8"),
      "late change\n",
    );
    await assert.rejects(
      prepareCleanup("room", project, project, "main", storage),
      /Only Lattice/,
    );
    await writeFile(join(path, ".gitignore"), "ignored.txt\n");
    const beforeIgnoredEdit = await prepareCleanup(
      "room",
      path,
      project,
      "session/feature",
      storage,
    );
    await writeFile(join(path, "ignored.txt"), "late ignored edit\n");
    await assert.rejects(
      cleanupSession(beforeIgnoredEdit, storage),
      /changed after/,
    );
    await cleanupSession(
      await prepareCleanup("room", path, project, "session/feature", storage),
      storage,
    );
    await assert.rejects(readFile(join(path, "source.txt")), /ENOENT/);
    await assert.rejects(
      git(project, ["rev-parse", "--verify", "refs/heads/session/feature"]),
    );
    assert.equal(await git(project, ["rev-parse", "main"]), main);
    assert.equal(
      await readFile(join(project, "source.txt"), "utf8"),
      "original\n",
    );
    assert.equal(await git(project, ["status", "--porcelain"]), "");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("discard rejects moved branches and unmanaged worktrees", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "lattice-cleanup-"));
  try {
    const project = join(scratch, "project"),
      storage = join(scratch, "sessions"),
      path = join(storage, "feature");
    await mkdir(project);
    await mkdir(storage);
    await git(project, ["init", "-b", "main"]);
    await git(project, ["config", "user.name", "Test"]);
    await git(project, ["config", "user.email", "test@example.invalid"]);
    await git(project, ["commit", "--allow-empty", "-m", "Base"]);
    await git(project, ["worktree", "add", "-b", "session/feature", path]);
    const job = await prepareCleanup(
      "room",
      path,
      project,
      "session/feature",
      storage,
    );
    await git(path, ["commit", "--allow-empty", "-m", "Late commit"]);
    await assert.rejects(cleanupSession(job, storage), /changed after/);
    const outside = join(scratch, "outside");
    await git(project, ["worktree", "add", "-b", "session/outside", outside]);
    await assert.rejects(
      prepareCleanup("room", outside, project, "session/outside", storage),
      /Only Lattice/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
