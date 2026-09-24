import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

// Shared by VS Code profiles. The relay must survive extension-host restarts
// when openFolder replaces the workspace in the same window.
export async function ensureLocalRelay(
  relay: string,
  options: { entry: string; legacyDataDir: string; registryRoot?: string },
) {
  const url = new URL(relay);
  if (
    url.protocol !== "ws:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    return;
  const port = Number(url.port || 80);
  const directory = join(
    options.registryRoot || join(homedir(), ".lattice", "relays"),
    String(port),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const health = async () => {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(700),
      });
    } catch {
      return false;
    }
    const info = (await response.json().catch(() => ({}))) as any;
    if (!response.ok || info.service !== "lattice-relay" || info.version < 3)
      throw Error(
        `Port ${port} is occupied by an incompatible or unhealthy service. Choose another Lattice relay port.`,
      );
    return true;
  };
  const running = await health();
  const registry = join(directory, "storage.json");
  // Preserve the old embedded relay's data location for its first detached restart.
  // A guest with no old store must not claim a running host's registry.
  if (!running || existsSync(join(options.legacyDataDir, "sessions.json"))) {
    const file = await open(registry, "wx", 0o600).catch((e) => {
      if (e.code !== "EEXIST") throw e;
      return undefined;
    });
    if (file) {
      try {
        await file.writeFile(
          JSON.stringify({
            dataDir: existsSync(join(options.legacyDataDir, "sessions.json"))
              ? options.legacyDataDir
              : join(directory, "data"),
          }),
        );
      } finally {
        await file.close();
      }
    }
  }
  if (running) return;
  // Another window can be finishing the atomic registry creation.
  let dataDir: string | undefined;
  for (let i = 0; i < 20 && !dataDir; i++) {
    try {
      dataDir = JSON.parse(await readFile(registry, "utf8")).dataDir;
    } catch {
      await delay(50);
    }
  }
  if (!dataDir)
    throw Error(
      "The local relay storage registry is unreadable. Your session data has been preserved.",
    );
  const log = await open(join(directory, "relay.log"), "a", 0o600);
  let failure: Error | undefined;
  try {
    const child = spawn(process.execPath, [options.entry], {
      cwd: directory,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log.fd, log.fd],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        HOST: "127.0.0.1",
        PORT: String(port),
        LATTICE_DATA_DIR: dataDir,
        LATTICE_AUTH: "",
        LATTICE_STORAGE_KEY: "",
        LATTICE_GITHUB_ORG: "",
      },
    });
    child.on("error", (error) => {
      failure = error;
    });
    child.unref();
  } finally {
    await log.close();
  }
  for (let i = 0; i < 60; i++) {
    if (await health()) return;
    if (failure) throw failure;
    await delay(100);
  }
  throw Error(
    `The local relay could not start. See ${join(directory, "relay.log")}.`,
  );
}
