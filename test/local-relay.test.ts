import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { SessionClient } from "../src/shared/client";
import { ensureLocalRelay } from "../src/extension/local-relay";

test("local relay survives its starting process and shares persistent sessions across profiles", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "lattice-daemon-test-"));
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((done) => socket.close(() => done()));
  const relay = `ws://127.0.0.1:${port}`,
    registryRoot = join(scratch, "registry");
  const entry = join(scratch, "relay.cjs"),
    helper = join(scratch, "helper.cjs"),
    pidfile = join(scratch, "pid");
  await build({
    entryPoints: ["src/relay/cli.ts"],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "cjs",
    banner: {
      js: `require('node:fs').writeFileSync(${JSON.stringify(pidfile)}, String(process.pid));`,
    },
  });
  await build({
    entryPoints: ["src/extension/local-relay.ts"],
    outfile: helper,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  const owner = new SessionClient(),
    guest = new SessionClient();
  const stop = async () => {
    const pid = Number(await readFile(pidfile, "utf8"));
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 50; i++) {
      if (
        !(await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined))
      )
        return;
      await delay(50);
    }
    throw Error("Test relay did not stop");
  };
  try {
    const options = {
      entry,
      legacyDataDir: join(scratch, "host-profile"),
      registryRoot,
    };
    // This short-lived parent is analogous to the extension host being replaced.
    await promisify(execFile)(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(helper)}).ensureLocalRelay(${JSON.stringify(relay)}, ${JSON.stringify(options)}).catch(e=>{console.error(e);process.exitCode=1})`,
      ],
      { timeout: 15000 },
    );
    const created = await owner.create(
      relay,
      "Persistent session",
      "repo",
      "session/test",
      { name: "Owner" },
    );
    const invite = await owner.request({ op: "invite", role: "editor" });
    await guest.join(relay, created.room, invite.token, { name: "Guest" });
    await ensureLocalRelay(relay, {
      ...options,
      legacyDataDir: join(scratch, "guest-profile"),
    });
    const registry = JSON.parse(
      await readFile(join(registryRoot, String(port), "storage.json"), "utf8"),
    );
    assert.equal(registry.dataDir, join(registryRoot, String(port), "data"));
    await owner.disconnect();
    assert.equal(guest.connected, true);
    await guest.disconnect();
    await stop();
    await ensureLocalRelay(relay, {
      ...options,
      legacyDataDir: join(scratch, "guest-profile"),
    });
    await owner.join(
      relay,
      created.room,
      created.token,
      { name: "Owner" },
      created.resume,
    );
    assert.equal(owner.session?.id, created.room);
    assert.equal(owner.credentials?.personId, created.personId);
  } finally {
    owner.dispose();
    guest.dispose();
    await stop().catch(() => {});
    await rm(scratch, { recursive: true, force: true });
  }
});
