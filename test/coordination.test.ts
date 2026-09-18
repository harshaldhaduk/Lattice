import { test } from "node:test";
import assert from "node:assert/strict";
import { startRelay } from "../src/relay/server";
import { SessionClient } from "../src/shared/client";
import { promptConflicts, type WorkIntent } from "../src/shared/coordination";
test("conflict sensitivity changes broader overlap checks but keeps direct file conflicts", () => {
  const base: WorkIntent = {
    id: "a",
    owner: "alice",
    prompt: "Refactor login validation sessions",
    files: [],
    readOnly: false,
    expires: Date.now() + 90000,
  };
  const peer = {
    ...base,
    id: "b",
    owner: "bob",
    prompt: "Improve login validation errors",
  };
  assert.equal(promptConflicts(base, [peer], 1).length, 0);
  assert.equal(promptConflicts(base, [peer], 10).length, 1);
  assert.equal(
    promptConflicts(
      { ...base, files: ["src/login.ts"] },
      [{ ...peer, files: ["login.ts"] }],
      1,
    ).length,
    1,
  );
  assert.equal(
    promptConflicts({ ...base, readOnly: true }, [peer], 10).length,
    0,
  );
});
test("simultaneous overlapping prompts reserve atomically, require review, and release on completion/disconnect", async () => {
  const relay = await startRelay({ port: 0 });
  const a = new SessionClient(),
    b = new SessionClient();
  try {
    const c = await a.create(
      `ws://127.0.0.1:${relay.port}`,
      "Coordination",
      "repo",
      "main",
      { name: "A" },
    );
    await b.join(c.relay, c.room, c.token, { name: "B" });
    const request = {
      op: "intent.claim",
      prompt: "Rewrite authentication in src/auth.ts",
      files: ["src/auth.ts"],
      readOnly: false,
      sensitivity: 6,
    };
    const replies = await Promise.all([
      a.request({ ...request, id: "a" }),
      b.request({ ...request, id: "b" }),
    ]);
    assert.equal(replies.filter((r) => r.accepted).length, 1);
    const winner = replies[0].accepted ? a : b,
      loser = winner === a ? b : a;
    const winnerId = winner === a ? "a" : "b",
      loserId = winner === a ? "b" : "a";
    await assert.rejects(
      loser.request({ op: "intent.release", id: winnerId }),
      /another participant/,
    );
    const allowed = await loser.request({
      ...request,
      id: loserId,
      acknowledged: [winnerId],
    });
    assert.ok(allowed.accepted);
    await winner.request({ op: "intent.release", id: winnerId });
    await loser.request({ op: "intent.release", id: loserId });
    assert.ok((await a.request({ ...request, id: "new" })).accepted);
    await a.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(
      (await b.request({ ...request, id: "after-disconnect" })).accepted,
    );
  } finally {
    a.dispose();
    b.dispose();
    await relay.close();
  }
});
