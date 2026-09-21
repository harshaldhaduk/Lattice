import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findUnfinishedSessions,
  type SavedMembership,
} from "../src/shared/session-reuse";
import type { SessionCard } from "../src/shared/protocol";

const repo = "https://github.com/team/project.git";
const card = (
  id: string,
  status: NonNullable<SessionCard["lifecycle"]>["status"] = "active",
): SessionCard => ({
  id,
  title: id,
  repo,
  branch: `session/${id}`,
  created: 1,
  people: [],
  pending: 0,
  completed: 0,
  steps: 0,
  lifecycle: {
    status,
    remote: repo,
    baseBranch: "main",
    baseCommit: "a".repeat(40),
  },
});
const member = (id: string, time = 1): SavedMembership => ({
  id,
  time,
  credentials: {
    room: id,
    relay: "ws://127.0.0.1:4319",
    token: "invite",
    resume: "resume",
    personId: "owner",
  },
});

test("resume suggestions match GitHub SSH/HTTPS identities, require membership, and prefer recent work", async () => {
  const first = card("first"),
    recent = card("recent", "review"),
    other = { ...card("other"), repo: "https://github.com/team/other.git" };
  const cards = [first, recent, other, card("not-a-member")];
  const observed: string[] = [];
  const results = await findUnfinishedSessions(
    "git@github.com:Team/Project.git",
    cards,
    [member("first", 10), member("recent", 20), member("other")],
    async (c) => {
      observed.push(c.room);
      return cards.find((s) => s.id === c.room);
    },
  );
  assert.deepEqual(
    results.map((s) => s.id),
    ["recent", "first"],
  );
  assert.deepEqual(observed.sort(), ["first", "recent"]);
});

test("fresh relay state excludes merged, closed, archived, and revoked memberships", async () => {
  const ids = ["merged", "closed", "archived", "revoked"];
  const results = await findUnfinishedSessions(
    repo,
    ids.map((id) => card(id)),
    ids.map((id) => member(id)),
    async (c) => {
      if (c.room === "revoked") return undefined;
      if (c.room === "archived") return { ...card(c.room), archived: true };
      return card(c.room, c.room as "merged" | "closed");
    },
  );
  assert.deepEqual(results, []);
});

test("offline lookup retains cached unfinished work without inventing unknown sessions", async () => {
  const results = await findUnfinishedSessions(
    repo,
    [card("saved"), card("done", "merged")],
    [member("saved"), member("done"), member("unknown")],
    async () => {
      throw Error("Relay offline");
    },
  );
  assert.deepEqual(
    results.map((s) => ({ id: s.id, verified: s.verified })),
    [{ id: "saved", verified: false }],
  );
});

test("uncached saved memberships are discovered without suggesting legacy sessions", async () => {
  const legacy = { ...card("legacy"), lifecycle: undefined };
  const results = await findUnfinishedSessions(
    repo,
    [],
    [member("fresh"), member("legacy")],
    async (c) => (c.room === "legacy" ? legacy : card("fresh", "attention")),
  );
  assert.deepEqual(
    results.map((s) => s.id),
    ["fresh"],
  );
});
