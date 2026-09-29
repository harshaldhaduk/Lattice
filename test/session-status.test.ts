import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompletedSession } from "../src/shared/session-status";
import type { SessionCard } from "../src/shared/protocol";

test("Completed includes review-ready work without archiving an open PR", () => {
  const session = {
    archived: false,
    lifecycle: { status: "review" },
  } as SessionCard;
  assert.equal(isCompletedSession(session), true);
  assert.equal(session.archived, false);
});
test("Active and attention-needed sessions remain active; archived sessions are completed", () => {
  for (const status of ["active", "attention", "reconciling"])
    assert.equal(
      isCompletedSession({
        archived: false,
        lifecycle: { status },
      } as SessionCard),
      false,
    );
  assert.equal(isCompletedSession({ archived: true }), true);
  assert.equal(isCompletedSession({ archived: false }), false);
});
