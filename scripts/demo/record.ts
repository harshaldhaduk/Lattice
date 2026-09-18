import { chromium, type Locator } from "playwright-core";
import { build } from "esbuild";
import { createServer, type ServerResponse } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { startRelay } from "../../src/relay/server";
import { SessionClient } from "../../src/shared/client";
import { contentHash } from "../../src/shared/files";
import { textUpdate } from "../../src/shared/collaboration";
import { changedCursor } from "../../src/shared/live-files";
import { inviteLink, parseInvite, type AppState, type Provider } from "../../src/shared/protocol";

async function main() {
const output = resolve("artifacts/demo");
await mkdir(output, { recursive: true });
await build({ entryPoints: ["scripts/demo/frame.tsx"], outfile: join(output, "frame.js"), bundle: true, platform: "browser", format: "iife", minify: true, target: "es2022" });
const relay = await startRelay({ port: 0 });
const clients = { alice: new SessionClient(), bob: new SessionClient() };
type User = keyof typeof clients;
const peers = new Set<ServerResponse>();
const runIds = { alice: "demo-alice-run", bob: "demo-bob-run" };
let invitation = "";
let actionError = "";
const state = (id: User): AppState => {
  const client = clients[id], me = client.credentials?.personId || "";
  const agent = client.session?.people.find(p => p.id === me)?.agent;
  return { me, session: client.session, connected: client.connected, repo: "northlight/lobby-service", branch: "fix/concurrent-join", file: id === "alice" ? "tests/join.test.ts" : "src/session_store.ts", liveSync: true, providers: [{ id: "codex", available: true }, { id: "claude", available: true }], run: agent ? { id: agent.runId, status: agent.status, task: agent.task, provider: agent.provider } : undefined };
};
const emit = () => { const text = `data: ${JSON.stringify({ alice: state("alice"), bob: state("bob") })}\n\n`; for (const peer of peers) peer.write(text); };
for (const client of Object.values(clients)) client.on("state", emit);
const provider = (id: User): Provider => id === "alice" ? "codex" : "claude";
async function action(id: User, message: any) {
  const client = clients[id];
  if (message.type === "host") await client.create(`ws://127.0.0.1:${relay.port}`, message.title, "northlight/lobby-service", "fix/concurrent-join", { name: "Alice" });
  if (message.type === "invite") { const invite = await client.request({ op: "invite", role: "editor" }); invitation = inviteLink(client.credentials!.relay, invite.room, invite.token); }
  if (message.type === "join") { const invite = parseInvite(message.link); await client.join(invite.relay, invite.room, invite.token, { name: "Bob" }); }
  if (message.type === "event") await client.event(message.event);
  if (message.type === "run") {
    await client.event({ type: "entry", kind: "message", text: message.prompt, provider: message.provider, runId: runIds[id] });
    await client.event({ type: "agent", provider: message.provider, status: "running", task: message.prompt, detail: id === "alice" ? "Writing the concurrent-join regression test" : "Preparing an atomic revision check", runId: runIds[id] });
    await client.event({ type: "entry", kind: "agent", text: id === "alice" ? "I’ll cover the race with two simultaneous joins. Bob’s agent can handle the guarded write." : "I’ll check the lobby revision in the write itself, so only one join can reserve this seat.", provider: message.provider, runId: runIds[id] });
  }
  if (message.type === "steer") {
    await client.event({ type: "entry", kind: "message", text: message.text, provider: provider(id), runId: runIds[id] });
    await client.event({ type: "entry", kind: "agent", text: "Understood. I’ll add an assertion for the stale-revision response, too.", provider: provider(id), runId: runIds[id] });
  }
  emit();
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/events") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); peers.add(res); emit(); req.on("close", () => peers.delete(res)); return; }
    if (url.pathname.startsWith("/state/")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(state(url.pathname.endsWith("alice") ? "alice" : "bob"))); return; }
    if (url.pathname.startsWith("/action/")) {
      let body = ""; for await (const part of req) { body += part; if (body.length > 100000) throw Error("Demo request too large"); }
      await action(url.pathname.endsWith("alice") ? "alice" : "bob", JSON.parse(body));
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true })); return;
    }
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(await readFile("scripts/demo/stage.html")); return; }
    if (url.pathname === "/frame") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/frame.css"></head><body><div id="root"></div><script src="/frame.js"></script></body></html>'); return; }
    if (["/frame.js", "/frame.css"].includes(url.pathname)) { res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "application/javascript"); res.end(await readFile(join(output, url.pathname.slice(1)))); return; }
    res.writeHead(404); res.end();
  } catch (error: any) { actionError = error.message; console.error(error); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--hide-scrollbars", "--font-render-hinting=none"] });
const context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, recordVideo: { dir: output, size: { width: 2560, height: 1440 } } });
const page = await context.newPage();
const video = page.video()!;
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const chapters: { time: number; title: string; narration: string }[] = [];
let started = Date.now();
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function chapter(number: number, title: string, caption: string, focus: string, narration: string) {
  console.log(`Chapter ${number}: ${title}`);
  chapters.push({ time: (Date.now() - started) / 1000, title, narration });
  await page.evaluate(({ number, title, caption, focus }) => (window as any).demoChapter(number, title, caption, focus), { number, title, caption, focus });
}
let cursor = { x: 1200, y: 700 };
async function click(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  if (!bounds) throw Error("Demo click target is not visible");
  const target = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  for (let n = 1; n <= 15; n++) {
    const t = n / 15, ease = t * t * (3 - 2 * t);
    await page.evaluate(({ x, y }) => (window as any).demoPointer(x, y, false), { x: cursor.x + (target.x - cursor.x) * ease, y: cursor.y + (target.y - cursor.y) * ease });
    await pause(18);
  }
  cursor = target;
  await page.evaluate(({ x, y }) => (window as any).demoPointer(x, y, true), target);
  await locator.click();
  await pause(350);
}
async function waitFor(check: () => boolean) { const until = Date.now() + 8000; while (!check()) { if (Date.now() > until) throw Error(actionError || "Demo state timed out"); await pause(50); } }
let previous = "", encoded: string | undefined;
const source = [
  "export async function reserveSlot(req: JoinRequest) {",
  "  const written = await db.lobbies.updateOne(",
  "    { id: req.lobbyId, revision: req.expectedRevision },",
  "    {",
  '      $set: { ["slots." + req.slot]: req.playerId },',
  "      $inc: { revision: 1 },",
  "    },",
  "  );",
  "",
  "  if (written.matchedCount === 0) {",
  '    return { ok: false, reason: "stale_revision" };',
  "  }",
  "",
  "  return { ok: true };",
  "}",
];
async function sourceUpdate(content: string) {
  const edit = textUpdate(previous, content, encoded);
  await clients.bob.event({ type: "document.update", file: "src/session_store.ts", isolated: false, runId: runIds.bob, beforeHash: contentHash(previous), baseMissing: true, content, ...changedCursor(previous, content), collaboration: { base: "", baseHash: contentHash(""), update: edit.update } });
  previous = content; encoded = edit.state;
}
try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "load" });
  const alice = page.frameLocator("#alice"), bob = page.frameLocator("#bob");
  await alice.getByRole("button", { name: "Start a session", exact: true }).waitFor();
  await page.screenshot({ path: join(output, "intro.png") });
  const captureStartOffset = 1;
  started = Date.now();
  chapters.push({ time: 0, title: "Two people, one shared workspace", narration: "Meet Alice and Bob. Two developers, working together in one Lattice session." });
  await pause(4200);
  await page.evaluate(() => document.querySelector("#overlay")!.classList.add("hide"));
  await chapter(1, "Invite a teammate.", "Alice starts the session. Bob joins with a shared invitation.", "alice", "Alice starts a session and shares an invitation. Bob joins the same workspace.");
  await click(alice.getByRole("button", { name: "Start a session", exact: true }));
  await alice.getByLabel("What are you building?").pressSequentially("Fix the lobby join race", { delay: 45 });
  await pause(400); await click(alice.getByRole("button", { name: "Create session", exact: true }));
  await waitFor(() => clients.alice.connected);
  await pause(700);
  await click(alice.getByRole("button", { name: "Invite", exact: true }));
  await pause(500);
  // The native share dialog copies a real scoped invitation through this demo adapter.
  const copy = alice.getByRole("button", { name: "Copy invitation", exact: true });
  if (await copy.count()) await click(copy.first());
  await waitFor(() => !!invitation);
  await page.keyboard.press("Escape");
  await click(bob.getByRole("button", { name: "Join with an invite", exact: true }));
  await bob.getByPlaceholder(/vscode:\/\//).fill(invitation);
  await pause(800); await click(bob.getByRole("button", { name: "Join session", exact: true }));
  await waitFor(() => clients.bob.connected); await pause(1000);
  await chapter(2, "Know who’s working where.", "File presence and teammate activity appear in both session panels.", "bob", "Both people can see who is connected, and which file their teammate is viewing.");
  await clients.alice.event({ type: "presence", file: "tests/join.test.ts", line: 5 });
  await clients.bob.event({ type: "presence", file: "src/session_store.ts", line: 5 });
  await pause(2100);
  await click(alice.locator(".demo-tabs button").filter({ hasText: "session_store.ts" }));
  await pause(2600);
  await chapter(3, "Different agents. The same session.", "Alice uses Codex for tests. Bob uses Claude for the fix.", "alice", "Alice asks Codex for a regression test. Bob asks Claude for the fix. Both use the same bottom prompt panel.");
  await bob.getByRole("combobox", { name: "AI provider", exact: true }).selectOption("claude");
  await click(alice.getByRole("textbox", { name: "Prompt your agent" }));
  await alice.getByRole("textbox", { name: "Prompt your agent" }).pressSequentially("Test two simultaneous joins. Assert that only one reserves the seat.", { delay: 34 });
  await click(alice.getByRole("button", { name: "Send prompt", exact: true }));
  await click(bob.getByRole("textbox", { name: "Prompt your agent" }));
  await bob.getByRole("textbox", { name: "Prompt your agent" }).pressSequentially("Make the seat write atomic. Check the lobby revision in the update.", { delay: 32 });
  await click(bob.getByRole("button", { name: "Send prompt", exact: true }));
  await waitFor(() => !!clients.bob.session?.people.find(p => p.name === "Bob")?.agent);
  await pause(1800);
  await chapter(4, "Watch the edit land, live.", "Bob’s agent writes. Alice sees the same source and moving avatar.", "", "As Bob's agent edits, Alice follows the work live. The source updates in both views, with a smooth moving avatar.");
  await sourceUpdate(source[0] + "\n");
  await click(alice.getByRole("button", { name: "Follow live edits" }).last());
  await page.evaluate(id => (window as any).demoView("bob", "live", id), clients.bob.credentials!.personId);
  await pause(900);
  for (let line = 1; line < source.length; line++) {
    const prefix = source.slice(0, line).join("\n") + "\n";
    const text = source[line];
    if (text.length) {
      const chunks = Math.max(1, Math.ceil(text.length / 11));
      for (let chunk = 1; chunk <= chunks; chunk++) { await sourceUpdate(prefix + text.slice(0, Math.ceil(text.length * chunk / chunks))); await pause(145); }
    } else { await sourceUpdate(prefix); await pause(220); }
    await pause(120);
  }
  await sourceUpdate(source.join("\n") + "\n");
  await clients.bob.event({ type: "entry", kind: "tool", runId: runIds.bob, provider: "claude", text: "Updated src/session_store.ts · guarded write + stale-revision response" });
  await page.screenshot({ path: join(output, "live-edit.png") });
  await pause(2000);
  await chapter(5, "Coordinate without switching tools.", "Read your teammate’s agent log and keep the regression test aligned.", "alice", "Alice can read Bob's agent conversation, then guide her own agent to cover the new error path.");
  await alice.getByRole("combobox", { name: "Agent conversation", exact: true }).selectOption(clients.bob.credentials!.personId);
  await pause(2900);
  await alice.getByRole("combobox", { name: "Agent conversation", exact: true }).selectOption(clients.alice.credentials!.personId);
  await click(alice.getByRole("textbox", { name: "Prompt your agent" }));
  await alice.getByRole("textbox", { name: "Prompt your agent" }).pressSequentially("Also assert that the second join returns stale_revision.", { delay: 33 });
  await click(alice.getByRole("button", { name: "Send guidance", exact: true }));
  await pause(2300);
  await chapter(6, "Review the result together.", "Shared activity, per-person usage, and a finished turn stay visible.", "", "The turn finishes with shared activity and usage visible to both people. One session, from the first prompt to the finished change.");
  await clients.alice.event({ type: "entry", kind: "agent", runId: runIds.alice, provider: "codex", text: "The regression test covers simultaneous joins and the stale-revision response. Ready for review." });
  await clients.bob.event({ type: "entry", kind: "agent", runId: runIds.bob, provider: "claude", text: "The guarded write is in place. The loser receives stale_revision so the caller can retry with a fresh read." });
  await clients.alice.event({ type: "usage", runId: runIds.alice, provider: "codex", input: 12480, output: 1680 });
  await clients.bob.event({ type: "usage", runId: runIds.bob, provider: "claude", input: 9810, output: 2140 });
  for (const id of ["alice", "bob"] as const) await clients[id].event({ type: "agent", runId: runIds[id], provider: provider(id), status: "done", task: id === "alice" ? "Concurrent-join regression coverage" : "Atomic seat reservation", detail: "Finished · ready for review" });
  await pause(1000);
  await click(alice.getByRole("button", { name: /^USAGE/ }));
  await click(bob.getByRole("button", { name: /^USAGE/ }));
  await pause(3300);
  await page.screenshot({ path: join(output, "review.png") });
  await page.evaluate(() => (window as any).demoEnd());
  await pause(4500);
  const duration = (Date.now() - started) / 1000;
  await writeFile(join(output, "manifest.json"), JSON.stringify({ duration, captureStartOffset, width: 2560, height: 1440, chapters, simulated: ["agent output", "provider usage"], real: ["session creation", "invitation", "membership", "presence", "document transport", "CRDT updates", "shared activity"], errors }, null, 2));
  if (actionError || errors.length) throw Error(actionError || errors.join("; "));
  console.log(JSON.stringify({ recorded: true, duration, chapters: chapters.length }));
} finally {
  await context.close();
  await video.saveAs(join(output, "two-users-source.webm"));
  await browser.close();
  for (const peer of peers) peer.end();
  await new Promise<void>(r => server.close(() => r()));
  clients.alice.dispose(); clients.bob.dispose(); await relay.close();
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
