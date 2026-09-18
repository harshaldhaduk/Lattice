import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "../src/extension/git";
import {
  createBranchSession,
  reconcileBranch,
  snapshot,
  publishPullRequest,
} from "../src/extension/branch-workflow";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import { isProviderLimit } from "../src/providers/limits";

async function repository() {
  const dir = await mkdtemp(join(tmpdir(), "lattice-flow-")),
    root = join(dir, "repo"),
    origin = join(dir, "origin.git");
  await mkdir(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await writeFile(join(root, "app.txt"), "base\n");
  await writeFile(join(root, "other.txt"), "old\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "base"]);
  await git(dir, ["init", "--bare", origin]);
  await git(root, ["remote", "add", "origin", origin]);
  await git(root, ["push", "-u", "origin", "main"]);
  return { dir, root, origin };
}
const passes = [[process.execPath, "-e", "process.exit(0)"]];
test("feature session starts from fetched main and reconciliation preserves local edits and new files", async () => {
  const { dir, root } = await repository();
  try {
    const session = await createBranchSession(
      root,
      join(dir, "sessions"),
      "My feature",
    );
    await writeFile(join(session.path, "app.txt"), "feature\n");
    await writeFile(join(session.path, "new.txt"), "new work\n");
    await writeFile(join(root, "other.txt"), "merged feature\n");
    await git(root, ["commit", "-am", "another feature"]);
    const target = await git(root, ["rev-parse", "HEAD"]);
    const result = await reconcileBranch({
      root: session.path,
      storage: join(dir, "candidates"),
      branch: session.branch,
      base: session.lifecycle.baseCommit,
      target,
      checks: passes,
      stillSafe: () => true,
    });
    assert.equal(
      await readFile(join(session.path, "app.txt"), "utf8"),
      "feature\n",
    );
    assert.equal(
      await readFile(join(session.path, "other.txt"), "utf8"),
      "merged feature\n",
    );
    assert.equal(
      await readFile(join(session.path, "new.txt"), "utf8"),
      "new work\n",
    );
    assert.equal(await git(root, ["branch", "--show-current"]), "main");
    assert.equal(await git(session.path, ["status", "--porcelain"]), "");
    await git(root, ["cat-file", "-e", result.checkpoint]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("conflict resolution and failed checks never overwrite the working checkout", async () => {
  const { dir, root } = await repository();
  try {
    const s = await createBranchSession(
      root,
      join(dir, "sessions"),
      "Conflicting feature",
    );
    await writeFile(join(s.path, "app.txt"), "mine\n");
    await writeFile(join(root, "app.txt"), "theirs\n");
    await git(root, ["commit", "-am", "upstream"]);
    const target = await git(root, ["rev-parse", "HEAD"]);
    const opts = {
      root: s.path,
      storage: join(dir, "candidates"),
      branch: s.branch,
      base: s.lifecycle.baseCommit,
      target,
      checks: [[process.execPath, "-e", "process.exit(1)"]],
      stillSafe: () => true,
      resolve: async (path: string, files: string[]) => {
        assert.deepEqual(files, ["app.txt"]);
        await writeFile(join(path, "app.txt"), "mine and theirs\n");
        await git(path, ["add", "app.txt"]);
      },
    };
    await assert.rejects(reconcileBranch(opts), /Candidate:/);
    assert.equal(await readFile(join(s.path, "app.txt"), "utf8"), "mine\n");
    assert.equal(
      await git(s.path, ["rev-parse", "HEAD"]),
      s.lifecycle.baseCommit,
    );
    assert.equal((await readdir(join(dir, "candidates"))).length, 1);
    await reconcileBranch({ ...opts, checks: passes });
    assert.equal(
      await readFile(join(s.path, "app.txt"), "utf8"),
      "mine and theirs\n",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("late edits reject a verified candidate and preserve staging during snapshot", async () => {
  const { dir, root } = await repository();
  try {
    const s = await createBranchSession(
      root,
      join(dir, "sessions"),
      "Late edit",
    );
    await writeFile(join(s.path, "app.txt"), "staged\n");
    await git(s.path, ["add", "app.txt"]);
    await writeFile(join(s.path, "app.txt"), "unstaged\n");
    const index = await git(s.path, ["diff", "--cached"]);
    await snapshot(s.path);
    assert.equal(await git(s.path, ["diff", "--cached"]), index);
    await writeFile(join(root, "other.txt"), "upstream\n");
    await git(root, ["commit", "-am", "upstream"]);
    const target = await git(root, ["rev-parse", "HEAD"]);
    let calls = 0;
    await assert.rejects(
      reconcileBranch({
        root: s.path,
        storage: join(dir, "candidates"),
        branch: s.branch,
        base: s.lifecycle.baseCommit,
        target,
        checks: passes,
        stillSafe: async () => {
          if (++calls === 2) {
            await writeFile(join(s.path, "new.txt"), "late");
            return false;
          }
          return true;
        },
      }),
      /Work changed/,
    );
    assert.equal(await readFile(join(s.path, "new.txt"), "utf8"), "late");
    assert.equal(await readFile(join(s.path, "app.txt"), "utf8"), "unstaged\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
async function team() {
  const relay = await startRelay({ port: 0 }),
    url = `ws://127.0.0.1:${relay.port}`,
    owner = new SessionClient(),
    a = new SessionClient(),
    b = new SessionClient();
  const c = await owner.create(
    url,
    "Feature",
    "https://github.com/team/project.git",
    "session/feature",
    { name: "Owner" },
  );
  await a.join(url, c.room, c.token, { name: "A" });
  await b.join(url, c.room, c.token, { name: "B" });
  return {
    relay,
    url,
    owner,
    a,
    b,
    c,
    close: async () => {
      owner.dispose();
      a.dispose();
      b.dispose();
      await relay.close();
    },
  };
}
test("editor steering waits for the agent owner; session owners steer directly; approvals cannot be replayed", async () => {
  const t = await team();
  try {
    const to = t.a.credentials!.personId;
    await t.a.event({
      type: "agent",
      provider: "claude",
      runId: "run",
      task: "task",
      status: "running",
      detail: "",
    });
    await t.b.event({
      type: "guidance.send",
      to,
      runId: "run",
      action: "steer",
      text: "Use the new API",
    });
    let g = t.relay.rooms.get(t.c.room)!.session.guidance![0];
    assert.equal(g.status, "approval");
    await assert.rejects(
      t.owner.event({ type: "guidance.decide", id: g.id, approve: true }),
      /agent's owner/,
    );
    await assert.rejects(
      t.a.event({
        type: "guidance.result",
        id: g.id,
        delivered: true,
        detail: "bypass",
      }),
      /unavailable/,
    );
    await t.a.event({ type: "guidance.decide", id: g.id, approve: true });
    assert.equal(g.status, "pending");
    await assert.rejects(
      t.a.event({ type: "guidance.decide", id: g.id, approve: true }),
      /owner/,
    );
    await t.owner.event({
      type: "guidance.send",
      to,
      runId: "run",
      action: "steer",
      text: "Owner guidance",
    });
    assert.equal(
      t.relay.rooms.get(t.c.room)!.session.guidance!.at(-1)!.status,
      "pending",
    );
  } finally {
    await t.close();
  }
});
test("provider limit offer has one winner and writes a linked continuity note", async () => {
  const t = await team();
  try {
    await t.owner.event({
      type: "agent",
      provider: "codex",
      runId: "limit",
      task: "Finish feature",
      status: "limited",
      detail: "usage limit reached",
    });
    await t.owner.event({ type: "handoff.limit", runId: "limit" });
    await t.owner.event({ type: "handoff.limit", runId: "limit" });
    const s = t.relay.rooms.get(t.c.room)!.session;
    assert.equal(s.handoffs.length, 1);
    const id = s.handoffs[0].id;
    const outcomes = await Promise.allSettled([
      t.a.event({ type: "handoff.decide", id, accept: true }),
      t.b.event({ type: "handoff.decide", id, accept: true }),
    ]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    assert.equal(s.memories.filter((n) => n.handoffId === id).length, 1);
    assert.match(s.memories.at(-1)!.text, /Finish feature/);
  } finally {
    await t.close();
  }
});
test("memory becomes stale on code changes and explicit review refreshes the anchor", async () => {
  const t = await team();
  try {
    await t.owner.request({
      op: "workspace.put",
      file: "app.ts",
      before: null,
      content: Buffer.from("before").toString("base64"),
    });
    await t.owner.request({ op: "workspace.ready", skipped: [] });
    await t.owner.event({
      type: "note.add",
      kind: "memories",
      text: "Old contract",
      file: "app.ts",
    });
    const room = t.relay.rooms.get(t.c.room)!;
    const note = room.session.memories[0];
    await t.owner.request({
      op: "workspace.put",
      file: "app.ts",
      before: room.workspaceFiles!["app.ts"].hash,
      content: Buffer.from("after").toString("base64"),
    });
    assert.equal(note.stale, true);
    await t.owner.event({
      type: "note.review",
      id: note.id,
      text: "New contract",
    });
    assert.equal(note.stale, false);
    assert.equal(note.anchorHash, room.workspaceFiles!["app.ts"].hash);
  } finally {
    await t.close();
  }
});
test("repository context requires membership and conflicts span authorized sessions", async () => {
  const t = await team(),
    other = new SessionClient();
  try {
    const c = await other.create(
      t.url,
      "Other feature",
      "git@github.com:team/project.git",
      "session/other",
      { name: "Other" },
    );
    let rows = await t.owner.request({ op: "brain.context", memberships: [] });
    assert.equal(rows.length, 1);
    rows = await t.owner.request({
      op: "brain.context",
      memberships: [{ room: c.room, resume: c.resume }],
    });
    assert.equal(rows.length, 2);
    await other.request({
      op: "intent.claim",
      id: "other-run",
      prompt: "Edit app.ts",
      files: ["app.ts"],
      readOnly: false,
      sensitivity: 6,
    });
    const claim = await t.owner.request({
      op: "intent.claim",
      id: "my-run",
      prompt: "Change app.ts",
      files: ["app.ts"],
      readOnly: false,
      sensitivity: 6,
    });
    assert.equal(claim.accepted, false);
    assert.match(claim.conflicts[0].prompt, /Other feature/);
  } finally {
    other.dispose();
    await t.close();
  }
});
test("only terminal provider limits qualify for handoff", () => {
  assert.equal(isProviderLimit(Error("usage_limit_reached")), true);
  assert.equal(isProviderLimit(Error("You hit your usage limit")), true);
  assert.equal(isProviderLimit(Error("Provider rate limit rejected")), true);
  for (const text of [
    "ECONNRESET",
    "Unauthorized",
    "context window too large",
    "connection timed out",
  ])
    assert.equal(isProviderLimit(Error(text)), false);
});

test("dashboard observation does not take over a live session and completion is owner/PR-bound", async () => {
  const t = await team(),
    observer = new SessionClient();
  try {
    await t.owner.event({
      type: "session.lifecycle",
      lifecycle: {
        baseBranch: "main",
        baseCommit: "a".repeat(40),
        remote: "https://github.com/team/project.git",
        status: "review",
        pullRequest: {
          number: 17,
          url: "https://github.com/team/project/pull/17",
          head: "b".repeat(40),
        },
      },
    });
    await observer.connect(t.url);
    const proof = { op: "session.observe", room: t.c.room, resume: t.c.resume };
    const result = await observer.request(proof);
    assert.equal(result.card.lifecycle.status, "review");
    assert.equal(t.owner.connected, true);
    await t.owner.event({
      type: "profile",
      profile: { name: "Still connected" },
    });
    await assert.rejects(
      observer.request({ ...proof, resume: "bad" }),
      /membership/,
    );
    await assert.rejects(
      observer.request({
        ...proof,
        resume: t.a.credentials!.resume,
        completion: { number: 17, status: "merged" },
      }),
      /owner/,
    );
    await assert.rejects(
      observer.request({
        ...proof,
        completion: { number: 18, status: "merged" },
      }),
      /linked PR/,
    );
    const done = await observer.request({
      ...proof,
      completion: { number: 17, status: "merged" },
    });
    assert.equal(done.card.archived, true);
    assert.equal(done.card.lifecycle.status, "merged");
  } finally {
    observer.dispose();
    await t.close();
  }
});
test("pending guidance is rejected when a turn ends or the sender loses editing permission", async () => {
  const t = await team();
  try {
    const to = t.a.credentials!.personId;
    const run = {
      type: "agent" as const,
      provider: "claude" as const,
      runId: "first",
      task: "task",
      detail: "",
    };
    await t.a.event({ ...run, status: "running" });
    await t.b.event({
      type: "guidance.send",
      to,
      runId: run.runId,
      action: "steer",
      text: "queued",
    });
    await t.a.event({ ...run, status: "done" });
    let g = t.relay.rooms.get(t.c.room)!.session.guidance![0];
    assert.equal(g.status, "rejected");
    await t.a.event({ ...run, runId: "second", status: "running" });
    await assert.rejects(
      t.a.event({ type: "guidance.decide", id: g.id, approve: true }),
      /owner/,
    );
    await t.b.event({
      type: "guidance.send",
      to,
      runId: "second",
      action: "steer",
      text: "queued again",
    });
    await t.owner.event({
      type: "role",
      personId: t.b.credentials!.personId,
      role: "viewer",
    });
    assert.equal(
      t.relay.rooms.get(t.c.room)!.session.guidance!.at(-1)!.status,
      "rejected",
    );
  } finally {
    await t.close();
  }
});
test("a reviewed recovery candidate is checked and applied without discarding manual resolution", async () => {
  const { dir, root } = await repository();
  try {
    const s = await createBranchSession(
      root,
      join(dir, "sessions"),
      "Recovery",
    );
    await writeFile(join(s.path, "app.txt"), "mine\n");
    await writeFile(join(root, "app.txt"), "theirs\n");
    await git(root, ["commit", "-am", "upstream"]);
    const opts = {
      root: s.path,
      storage: join(dir, "candidates"),
      branch: s.branch,
      base: s.lifecycle.baseCommit,
      target: await git(root, ["rev-parse", "HEAD"]),
      checks: passes,
      stillSafe: () => true,
    };
    let recovery: any;
    try {
      await reconcileBranch(opts);
    } catch (e: any) {
      recovery = e.recovery;
    }
    assert.ok(recovery);
    await writeFile(
      join(recovery.candidate, "app.txt"),
      "reviewed resolution\n",
    );
    await git(recovery.candidate, ["add", "app.txt"]);
    await reconcileBranch({ ...opts, recovery });
    assert.equal(
      await readFile(join(s.path, "app.txt"), "utf8"),
      "reviewed resolution\n",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PR publication binds the reviewed tree and recovers an acknowledged GitHub timeout without duplicates", async () => {
  const { dir, root } = await repository();
  const oldPath = process.env.PATH,
    oldState = process.env.LATTICE_TEST_PR;
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    const gh = join(bin, "gh");
    await writeFile(
      gh,
      `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2),file=process.env.LATTICE_TEST_PR;const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return null}};if(args[0]==='pr'&&args[1]==='list'){console.log(JSON.stringify(read()?[read()]:[]));}else if(args[0]==='pr'&&args[1]==='create'){if(read())throw Error('duplicate');fs.writeFileSync(file,JSON.stringify({number:7,url:'https://github.com/team/project/pull/7',state:'OPEN',headRefOid:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baseRefName:args[args.indexOf('--base')+1]}));process.exit(1);}else throw Error('Unexpected command');`,
    );
    await chmod(gh, 0o755);
    process.env.PATH = bin + ":" + oldPath;
    process.env.LATTICE_TEST_PR = join(dir, "pr.json");
    const s = await createBranchSession(root, join(dir, "sessions"), "PR test");
    await writeFile(join(s.path, "new.txt"), "reviewed work");
    const reviewed = await snapshot(s.path);
    const pr = await publishPullRequest(
      s.path,
      s.branch,
      "main",
      "PR test",
      "Body\nwith real newlines",
      reviewed,
    );
    assert.equal(pr.number, 7);
    assert.equal(
      await git(root, ["rev-parse", `refs/remotes/origin/${s.branch}`]),
      pr.headRefOid,
    );
    const repeat = await publishPullRequest(
      s.path,
      s.branch,
      "main",
      "PR test",
      "Body",
      await snapshot(s.path),
    );
    assert.equal(repeat.number, 7);
    const old = await snapshot(s.path);
    await writeFile(join(s.path, "new.txt"), "late changes");
    await assert.rejects(
      publishPullRequest(s.path, s.branch, "main", "Unsafe", "Body", old),
      /changed after review/,
    );
    assert.equal(
      await git(root, ["rev-parse", `refs/remotes/origin/${s.branch}`]),
      pr.headRefOid,
    );
  } finally {
    process.env.PATH = oldPath;
    if (oldState === undefined) delete process.env.LATTICE_TEST_PR;
    else process.env.LATTICE_TEST_PR = oldState;
    await rm(dir, { recursive: true, force: true });
  }
});
