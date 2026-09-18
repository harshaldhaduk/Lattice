import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, checkFileApply } from "../src/shared/files";
import type { FileShare } from "../src/shared/protocol";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
const share: FileShare = {
  id: "file",
  author: "author",
  file: "src/a.ts",
  baseCommit: "a".repeat(40),
  baseHash: contentHash("before\n"),
  hash: contentHash("after\n"),
  content: "after\n",
  time: 0,
  receipts: {},
};
test("shared file application requires reviewed content and protects local edits", () => {
  assert.equal(checkFileApply(share, "before\n", false, share.hash), "apply");
  assert.equal(
    checkFileApply(share, "after\n", false, share.hash),
    "unchanged",
  );
  assert.throws(
    () => checkFileApply(share, "before\n", true, share.hash),
    /local edits/,
  );
  assert.throws(
    () => checkFileApply(share, "before\n", false),
    /Review this exact/,
  );
  assert.throws(
    () => checkFileApply(share, "locally changed\n", false, share.hash),
    /differs from the shared base/,
  );
  assert.throws(
    () =>
      checkFileApply(
        { ...share, content: "tampered" },
        "before\n",
        false,
        share.hash,
      ),
    /checksum/,
  );
  assert.throws(
    () => checkFileApply(share, "before\r\n", false, share.hash),
    /differs/,
  );
});
test("file sharing isolates authors, binds receipts to exact versions, and enforces roles", async () => {
  const relay = await startRelay({ port: 0 });
  const url = `ws://127.0.0.1:${relay.port}`;
  const a = new SessionClient(),
    b = new SessionClient(),
    v = new SessionClient();
  const tick = () => new Promise((r) => setTimeout(r, 20));
  try {
    const c = await a.create(url, "Files", "repo", "main", { name: "Author" });
    await b.join(url, c.room, c.token, { name: "Peer" });
    const invite = await a.request({ op: "invite", role: "viewer" });
    await v.join(url, c.room, invite.token, { name: "Viewer" });
    const event = {
      type: "file.share" as const,
      file: share.file,
      baseCommit: share.baseCommit,
      baseHash: share.baseHash,
      content: share.content,
    };
    await a.event(event);
    await tick();
    const first = b.session!.files![0];
    assert.equal(first.author, c.personId);
    assert.equal(first.hash, contentHash(share.content));
    await assert.rejects(v.event(event), /read-only/);
    await assert.rejects(
      b.event({ type: "file.withdraw", id: first.id }),
      /Only the author/,
    );
    await b.event({
      type: "file.receipt",
      id: first.id,
      hash: first.hash,
      status: "applied",
    });
    await tick();
    assert.equal(
      a.session!.files![0].receipts[b.credentials!.personId],
      "applied",
    );
    await a.event({ ...event, content: "newer version\n" });
    await tick();
    const next = b.session!.files![0];
    assert.notEqual(next.id, first.id);
    assert.deepEqual(next.receipts, {});
    assert.equal(b.session!.files!.length, 1);
    await assert.rejects(
      b.event({
        type: "file.receipt",
        id: first.id,
        hash: first.hash,
        status: "applied",
      }),
      /no longer available/,
    );
    await assert.rejects(
      b.event({
        type: "file.receipt",
        id: next.id,
        hash: first.hash,
        status: "applied",
      }),
      /no longer available/,
    );
    await b.event(event);
    await tick();
    assert.equal(a.session!.files!.length, 2);
    await a.event({ type: "file.withdraw", id: next.id });
    await tick();
    assert.equal(a.session!.files!.length, 1);
    await assert.rejects(
      a.request({ op: "event", event: { ...event, file: "../secret" } }),
      /Invalid/,
    );
    await assert.rejects(
      a.request({
        op: "event",
        event: { ...event, content: "x".repeat(32001) },
      }),
      /Invalid/,
    );
    await assert.rejects(
      a.request({ op: "event", event: { ...event, content: "binary\0" } }),
      /Invalid/,
    );
  } finally {
    a.dispose();
    b.dispose();
    v.dispose();
    await relay.close();
  }
});
