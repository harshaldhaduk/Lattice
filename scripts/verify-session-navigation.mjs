// Real VS Code workspace replacement and return/discard regression test.
// Uses two disposable profiles and a local Git fixture; never touches user repos.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import WebSocket from "ws";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  cp,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
const exec = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), "lattice-window-test-"));
const children = [],
  browsers = [];
let relayPid;
async function port() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}
async function until(fn, message, timeout = 45000) {
  const start = Date.now();
  let error;
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      error = e;
    }
    await delay(300);
  }
  throw Error(`${message}: ${error?.message || "timeout"}`);
}
async function evaluate(debug, expression) {
  const [target] = await (
    await fetch(`http://127.0.0.1:${debug}/json/list`)
  ).json();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(Error("Inspector timeout"));
    }, 12000);
    const finish = (fn, value) => {
      clearTimeout(timer);
      ws.close();
      fn(value);
    };
    ws.on("error", (error) => finish(reject, error));
    ws.on("close", () => {
      clearTimeout(timer);
      reject(Error("Extension host restarted"));
    });
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      ),
    );
    ws.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message.id !== 1) return;
      if (message.result?.exceptionDetails)
        finish(
          reject,
          Error(message.result.exceptionDetails.exception?.description),
        );
      else finish(resolve, message.result?.result?.value);
    });
  });
}
const git = async (cwd, args) =>
  (await exec("git", args, { cwd })).stdout.trimEnd();
try {
  const project = join(scratch, "project"),
    other = join(scratch, "other-project"),
    origin = join(scratch, "origin.git"),
    extension = join(scratch, "extension");
  await mkdir(project);
  await mkdir(other);
  await mkdir(extension);
  await git(project, ["init", "-b", "main"]);
  await git(project, ["config", "user.name", "Test"]);
  await git(project, ["config", "user.email", "test@example.invalid"]);
  await writeFile(
    join(project, "source.ts"),
    "export const original = true;\n",
  );
  await git(project, ["add", "."]);
  await git(project, ["commit", "-m", "Base"]);
  await git(scratch, ["init", "--bare", origin]);
  await git(project, ["remote", "add", "origin", origin]);
  await git(project, ["push", "origin", "main"]);
  const remote = "https://github.com/lattice-fixture/navigation.git";
  await git(project, ["remote", "set-url", "origin", remote]);
  // Keep the fixture's public-shaped origin in lifecycle metadata while Git
  // fetch/clone are redirected to its private local bare repository.
  const bin = join(scratch, "bin");
  await mkdir(bin);
  const realGit = (await exec("which", ["git"])).stdout.trim();
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh\nif [ "$1" = remote ] && [ "$2" = get-url ]; then exec '${realGit}' config --get remote.origin.url; fi\nexec '${realGit}' "$@"\n`,
    { mode: 0o755 },
  );
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  await writeFile(
    join(extension, "package.json"),
    JSON.stringify({ ...pkg, main: "./driver.cjs" }),
  );
  await cp(resolve("dist"), join(extension, "dist"), { recursive: true });
  await cp(resolve("media"), join(extension, "media"), { recursive: true });
  // The test-only command exposes fixture membership to the runner, never logs it.
  await build({
    stdin: {
      contents: `
    import * as vscode from 'vscode';
    import { activate as realActivate } from '${resolve("src/extension/extension.ts")}';
    export async function activate(context) {
      process.env.PATH = ${JSON.stringify(bin + ":")} + process.env.PATH;
      let ready = false;
      context.subscriptions.push(vscode.commands.registerCommand('lattice.test.state', async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        const proof = await context.secrets.get('session:' + root?.toString());
        return { root: root?.fsPath, proof: proof && JSON.parse(proof), storage: context.globalStorageUri.fsPath, ready };
      }));
      await realActivate(context);
      ready = true;
    }
  `,
      resolveDir: resolve("."),
      loader: "ts",
    },
    outfile: join(extension, "driver.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode", "@anthropic-ai/claude-agent-sdk"],
    define: { navigator: "undefined" },
  });
  const relayPort = await port();
  async function launch(name, folder) {
    const profile = join(scratch, name),
      debug = await port(),
      cdp = await port();
    await mkdir(join(profile, "User"), { recursive: true });
    await writeFile(
      join(profile, "User", "settings.json"),
      JSON.stringify({
        "lattice.relayUrl": `ws://127.0.0.1:${relayPort}`,
        "workbench.startupEditor": "none",
        "window.confirmBeforeClose": "never",
        "window.dialogStyle": "custom",
        "telemetry.telemetryLevel": "off",
      }),
    );
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${origin}.insteadOf`,
      GIT_CONFIG_VALUE_0: remote,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
      [
        `--user-data-dir=${profile}`,
        `--extensions-dir=${join(profile, "extensions")}`,
        `--extensionDevelopmentPath=${extension}`,
        `--inspect-extensions=${debug}`,
        `--remote-debugging-port=${cdp}`,
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        folder,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(child);
    let log = "";
    child.stdout.on("data", (s) => (log += s));
    child.stderr.on("data", (s) => (log += s));
    const browser = await until(
      () => chromium.connectOverCDP(`http://127.0.0.1:${cdp}`),
      "VS Code browser",
    );
    browsers.push(browser);
    const debugPort = async () => {
      const directory = (await readdir(join(profile, "logs"))).sort().at(-1);
      const renderer = await readFile(
        join(profile, "logs", directory, "window1", "renderer.log"),
        "utf8",
      );
      const pid = [
        ...renderer.matchAll(/Started local extension host with pid (\d+)/g),
      ].at(-1)?.[1];
      if (!pid) throw Error("Extension host is starting");
      const listening = (
        await exec("lsof", ["-nP", "-a", "-p", pid, "-iTCP", "-sTCP:LISTEN"])
      ).stdout;
      return Number(listening.match(/127\.0\.0\.1:(\d+)/)?.[1] || debug);
    };
    const command = async (id, ...args) =>
      evaluate(
        await debugPort(),
        `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(extension, "driver.cjs"))})('vscode').commands.executeCommand(${[id, ...args].map((x) => JSON.stringify(x)).join(",")})`,
      );
    const state = () => command("lattice.test.state");
    await until(async () => {
      const s = await state();
      return s?.ready && s.root === folder;
    }, `Activate ${name}`);
    return { browser, child, command, state, debugPort, log: () => log };
  }
  const host = await launch("host", project);
  console.log("Native host ready");
  // Folder replacement restarts the extension host before the command returns.
  await host.command("lattice.newSession", "Window navigation").catch(() => {});
  const hosted = await until(async () => {
    const s = await host.state();
    return s?.ready && s.proof && s.root !== project && s;
  }, "Host same-window switch");
  relayPid = Number(
    (await exec("lsof", ["-ti", `TCP:${relayPort}`, "-sTCP:LISTEN"])).stdout
      .trim()
      .split("\n")[0],
  );
  assert.equal(
    host.browser
      .contexts()[0]
      .pages()
      .filter((p) => p.url().includes("workbench")).length,
    1,
  );
  const guest = await launch("guest", other);
  // Ask the relay for an invite through the actual host UI command and read it
  // in-memory from the clipboard, restoring the user's clipboard immediately.
  const clipboard = await evaluate(
    await host.debugPort(),
    `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(extension, "driver.cjs"))})('vscode').env.clipboard.readText()`,
  );
  await host.command("lattice.invite");
  const debugHost = await host.debugPort();
  const invite = await evaluate(
    debugHost,
    `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(extension, "driver.cjs"))})('vscode').env.clipboard.readText()`,
  );
  await evaluate(
    debugHost,
    `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(extension, "driver.cjs"))})('vscode').env.clipboard.writeText(${JSON.stringify(clipboard)})`,
  );
  assert.ok(invite.startsWith("vscode://"), "Invite must be copied");
  await guest.command("lattice.join", invite).catch(() => {});
  console.log("Guest join command sent");
  const joined = await until(async () => {
    const s = await guest.state();
    return s?.ready && s.proof && s.root !== other && s;
  }, "Guest same-window switch");
  assert.equal(
    guest.browser
      .contexts()[0]
      .pages()
      .filter((p) => p.url().includes("workbench")).length,
    1,
  );
  assert.equal(hosted.proof.room, joined.proof.room);
  assert.equal(
    await git(hosted.root, ["branch", "--show-current"]),
    await git(joined.root, ["branch", "--show-current"]),
  );
  assert.equal(
    await readFile(join(joined.root, "source.ts"), "utf8"),
    "export const original = true;\n",
  );
  await writeFile(
    join(hosted.root, "shared.ts"),
    "export const shared = true;\n",
  );
  await until(
    async () =>
      (await readFile(join(joined.root, "shared.ts"), "utf8")) ===
      "export const shared = true;\n",
    "Live sync after switch",
  );
  console.log(
    "Host and guest reused their windows, loaded files, and synced edits",
  );
  // Drive the real return quick pick in the guest, preserving its local clone.
  void guest.command("lattice.returnToProject").catch(() => {});
  let page = guest.browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes("workbench"));
  await page.locator(".quick-input-widget").waitFor({ state: "visible" });
  await page.keyboard.press("Enter");
  await until(
    async () => (await guest.state())?.root === other,
    "Guest return",
  );
  // Exercise the owner's confirmation and deferred deletion after replacement.
  void host.command("lattice.returnToProject").catch(() => {});
  page = host.browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes("workbench"));
  await page.bringToFront();
  await page.locator(".quick-input-widget input").fill("Discard session");
  await page
    .getByText("Discard session and local branch", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard branch", exact: true })
    .click();
  // Observe the visible workspace and actual cleanup after the extension host
  // has been replaced, instead of depending on an obsolete debugger connection.
  await until(async () => {
    const current = host.browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("workbench"));
    return (
      (await current.title()).includes("project") &&
      (await readFile(join(hosted.root, "source.ts")).then(
        () => false,
        (error) => error.code === "ENOENT",
      ))
    );
  }, "Owner return and cleanup");
  await until(
    async () => !(await git(project, ["branch", "--list", "session/*"])).trim(),
    "Local branch cleanup",
  );
  await assert.rejects(readFile(join(hosted.root, "source.ts")), /ENOENT/);
  assert.equal(
    (await git(project, ["branch", "--list", "session/*"])).trim(),
    "",
  );
  assert.equal(
    await readFile(join(project, "source.ts"), "utf8"),
    "export const original = true;\n",
  );
  assert.equal(
    host.browser
      .contexts()[0]
      .pages()
      .filter((p) => p.url().includes("workbench")).length,
    1,
  );
  // The process is detached from both extension hosts; it remains up after exit.
  const pids = (
    await exec("lsof", ["-ti", `TCP:${relayPort}`, "-sTCP:LISTEN"])
  ).stdout
    .trim()
    .split("\n");
  relayPid = Number(pids[0]);
  for (const browser of browsers) await browser.close();
  for (const child of children) child.kill();
  await delay(600);
  assert.equal((await fetch(`http://127.0.0.1:${relayPort}/health`)).ok, true);
  console.log(
    "LATTICE_SAME_WINDOW_OK: create/join kept two windows; files synced; return/discard removed only fixture branch; relay survived both windows",
  );
} catch (error) {
  console.error(error);
  for (const browser of browsers)
    for (const page of browser.contexts()[0]?.pages() || []) {
      console.error(
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(-4500),
      );
    }
  throw error;
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of children) child.kill();
  if (relayPid)
    try {
      process.kill(relayPid, "SIGTERM");
    } catch {}
  // Keep failed fixture/logs for diagnosis; successful runs can be removed.
  console.log(`Native test fixture: ${scratch}`);
}
