import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash } from "../src/shared/files";
import {
  canSyncDocument,
  changedCursor,
  sourceFile,
} from "../src/shared/live-files";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import type { LiveDocument } from "../src/shared/protocol";
const doc: LiveDocument = {
  key: "main:src/a.ts",
  isolated: false,
  file: "src/a.ts",
  author: "a",
  runId: "run",
  provider: "codex",
  content: "after\n",
  hash: contentHash("after\n"),
  baseHash: contentHash("before\n"),
  previousHash: contentHash("intermediate\n"),
  baseMissing: false,
  version: 2,
  line: 0,
  column: 5,
  updated: 0,
};
test("live synchronization accepts a matching base and preserves dirty or divergent local files", () => {
  assert.equal(canSyncDocument(doc, "before\n", false).ok, true);
  assert.equal(canSyncDocument(doc, "intermediate\n", false).ok, true);
  assert.equal(
    canSyncDocument(
      doc,
      "my previous version",
      false,
      contentHash("my previous version"),
    ).ok,
    true,
  );
  assert.equal(canSyncDocument(doc, "local changes", false).ok, false);
  assert.equal(canSyncDocument(doc, "before\n", true).ok, false);
  assert.equal(canSyncDocument(doc, undefined, false).ok, false);
  assert.equal(
    canSyncDocument({ ...doc, baseMissing: true }, undefined, false).ok,
    true,
  );
  assert.equal(canSyncDocument(doc, "after\n", false).unchanged, true);
  assert.deepEqual(changedCursor("one\nend", "one\ntwo\nend"), {
    line: 2,
    column: 0,
  });
  assert.deepEqual(changedCursor("const x = 1;", "const x = 20;"), {
    line: 0,
    column: 12,
  });
  assert.ok(sourceFile("src/module.ts"));
  assert.ok(!sourceFile(".env.local"));
  assert.ok(!sourceFile(".vscode/settings.json"));
  assert.ok(!sourceFile(".codex/config.toml"));
  assert.ok(!sourceFile("node_modules/pkg/index.js"));
});
test("live agent updates arrive incrementally, reject stale writers, and isolate worktrees", async () => {
  const relay = await startRelay({ port: 0 });
  const a = new SessionClient(),
    b = new SessionClient();
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Live",
      "repo",
      "main",
      { name: "A" },
    );
    await b.join(c.relay, c.room, c.token, { name: "B" });
    await a.event({
      type: "agent",
      provider: "codex",
      runId: "a-run",
      status: "running",
      task: "Edit",
      detail: "",
    });
    await b.event({
      type: "agent",
      provider: "claude",
      runId: "b-run",
      status: "running",
      task: "Edit",
      detail: "",
    });
    const first = {
      type: "document.update" as const,
      isolated: false,
      file: "src/a.ts",
      runId: "a-run",
      beforeHash: contentHash("base"),
      baseMissing: false,
      content: "first",
      line: 0,
      column: 5,
    };
    await a.event(first);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.session!.documents![0].content, "first");
    assert.equal(b.session!.documents![0].version, 1);
    await a.event({
      ...first,
      beforeHash: contentHash("first"),
      content: "second",
      column: 6,
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.session!.documents![0].content, "second");
    assert.equal(b.session!.documents![0].baseHash, contentHash("base"));
    await assert.rejects(
      b.event({ ...first, runId: "b-run", content: "competing" }),
      /conflict/,
    );
    await b.event({
      ...first,
      runId: "b-run",
      isolated: true,
      content: "isolated",
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(a.session!.documents!.length, 2);
    assert.equal(
      a.session!.documents!.find((d) => !d.isolated)!.content,
      "second",
    );
    await assert.rejects(
      b.event({ ...first, runId: "not-current" }),
      /current agent/,
    );
  } finally {
    a.dispose();
    b.dispose();
    await relay.close();
  }
});
