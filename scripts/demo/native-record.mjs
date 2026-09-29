import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import WebSocket from "ws";

const exec = promisify(execFile);
const root = resolve(".");
const output = resolve("artifacts/demo-native");
const movie = resolve("artifacts/lattice-native-vscode-demo.mp4");
const scratch = await mkdtemp(join(tmpdir(), "lattice-native-demo-"));
const children = [];
const browsers = [];
const shots = [];
let relayPid;

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}

async function until(fn, message, timeout = 60000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await delay(250);
  }
  throw Error(`${message}: ${last?.message || "timeout"}`);
}

async function evaluate(debug, expression) {
  const targets = await (
    await fetch(`http://127.0.0.1:${debug}/json/list`)
  ).json();
  const target = targets.find((item) => item.type === "node") || targets[0];
  if (!target) throw Error("Extension host inspector is unavailable");
  return new Promise((resolveValue, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(Error("Extension host inspector timed out"));
    }, 15000);
    const finish = (fn, value) => {
      clearTimeout(timer);
      socket.close();
      fn(value);
    };
    socket.on("error", (error) => finish(reject, error));
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      ),
    );
    socket.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message.id !== 1) return;
      if (message.result?.exceptionDetails)
        finish(
          reject,
          Error(message.result.exceptionDetails.exception?.description),
        );
      else finish(resolveValue, message.result?.result?.value);
    });
  });
}

const git = async (cwd, args) =>
  (await exec("git", args, { cwd })).stdout.trimEnd();

async function workbench(instance) {
  return until(
    async () => {
      const pages = instance.browser.contexts()[0]?.pages() || [];
      const page = pages.find((candidate) =>
        candidate.url().includes("workbench"),
      );
      if (!page || page.isClosed()) return undefined;
      if (process.env.LATTICE_RECORDLY) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        await cdp.detach();
      } else await page.setViewportSize({ width: Number(process.env.LATTICE_CAPTURE_WIDTH || 2560), height: 1120 }).catch(() => {});
      return page;
    },
    `${instance.name} workbench`,
  );
}

async function frameWith(page, text) {
  return until(async () => {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith("vscode-webview://")) continue;
      const body = await frame.locator("body").innerText().catch(() => "");
      if (body.includes(text)) return frame;
    }
    return undefined;
  }, `Webview containing ${text}`);
}

async function palette(page, text, captureName) {
  await page.keyboard.press("Control+Shift+p");
  const input = page.locator(".quick-input-widget input").last();
  await input.waitFor({ state: "visible" });
  await input.fill(text);
  await delay(550);
  if (captureName) await capture(page, captureName, 1.6);
  await page.keyboard.press("Enter");
  await delay(700);
}

async function latticeActivity(page, captureName) {
  const action = page.locator('[aria-label^="Lattice Sessions"]').first();
  await action.waitFor({ state: "visible", timeout: 30000 });
  await action.hover();
  if (captureName) await capture(page, captureName, 1.6);
  await action.click();
  return frameWith(page, "Your sessions");
}

async function frameWithButton(page, name) {
  return until(async () => {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith("vscode-webview://")) continue;
      if (await frame.getByRole("button", { name, exact: true }).count())
        return frame;
    }
    return undefined;
  }, `Webview button ${name}`);
}

async function capture(page, name, seconds) {
  const path = join(
    output,
    `${String(shots.length).padStart(2, "0")}-${name}.png`,
  );
  await page.bringToFront();
  await page.screenshot({ path, animations: "disabled" });
  shots.push({ path, seconds, name });
  console.log(`Captured ${name}`);
}

async function launch(name, folder, extensionPath, profileName, relayPort, bin) {
  const profile = join(scratch, `${name}-profile`);
  const extensions = join(scratch, `${name}-extensions`);
  const debug = await freePort();
  const cdp = await freePort();
  await mkdir(join(profile, "User"), { recursive: true });
  await mkdir(extensions, { recursive: true });
  await writeFile(
    join(profile, "User", "settings.json"),
    JSON.stringify(
      {
        "lattice.relayUrl": `ws://127.0.0.1:${relayPort}`,
        "lattice.taskCheckCommand": ["npm", "test"],
        "workbench.startupEditor": "none",
        "workbench.colorTheme": "Default Dark Modern",
        "workbench.reduceMotion": "off",
        "workbench.secondarySideBar.defaultVisibility": "hidden",
        "window.confirmBeforeClose": "never",
        "window.dialogStyle": "custom",
        "window.menuStyle": "custom",
        ...(process.env.LATTICE_FINAL_DEMO ? { "window.titleBarStyle": "native" } : {}),
        "window.zoomLevel": 1,
        ...(process.env.LATTICE_CAPTURE_WIDTH ? {"window.zoomLevel": 0, "editor.fontSize": 15, "editor.minimap.enabled": false, "window.title": profileName + ' — ${rootName} — VS Code'} : {}),
        ...(process.env.LATTICE_DEMO_CODEX ? {"lattice.codexPath": process.env.LATTICE_DEMO_CODEX} : {}),
        "security.workspace.trust.enabled": false,
        "telemetry.telemetryLevel": "off",
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "terminal.integrated.env.osx": {
          PATH: `${bin}:${process.env.PATH}`,
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(profile, "User", "keybindings.json"),
    JSON.stringify([
      {
        key: "ctrl+shift+p",
        command: "workbench.action.showCommands",
      },
    ]),
  );
  const args = [
    `--user-data-dir=${profile}`,
    `--extensions-dir=${extensions}`,
    `--inspect-extensions=${debug}`,
    `--remote-debugging-port=${cdp}`,
    "--force-device-scale-factor=1",
    "--window-size=2560,1120",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    ...(process.env.LATTICE_RECORDLY ? ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] : []),
  ];
  if (extensionPath) args.push(`--extensionDevelopmentPath=${extensionPath}`);
  if (process.env.LATTICE_RECORDLY) args.push('--');
  args.push(folder);
  const env = {
    ...process.env,
    VSCODE_CLI: '1',
    PATH: `${bin}:${process.env.PATH}`,
    LATTICE_DEMO_NAME: profileName,
    LATTICE_DEMO_PR_STATE: join(scratch, "pr-created"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    args,
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  let log = "";
  child.stdout.on("data", (data) => (log += data));
  child.stderr.on("data", (data) => (log += data));
  const browser = await until(
    () => chromium.connectOverCDP(`http://127.0.0.1:${cdp}`),
    `${name} CDP`,
  );
  browsers.push(browser);
  const instance = {
    name,
    profile,
    extensions,
    debug,
    browser,
    child,
    extensionPath,
    log: () => log,
  };
  instance.debugPort = async () => {
    const logs = join(profile, "logs");
    let pid;
    for (const directory of (await readdir(logs)).sort().reverse()) {
      const base = join(logs, directory);
      const windows = await readdir(base).catch(() => []);
      for (const window of windows.filter((name) => name.startsWith("window"))) {
        const renderer = await readFile(
          join(base, window, "renderer.log"),
          "utf8",
        ).catch(() => "");
        pid = [
          ...renderer.matchAll(/Started local extension host with pid (\d+)/g),
        ].at(-1)?.[1];
        if (pid) break;
      }
      if (pid) break;
    }
    if (!pid) throw Error("Extension host is still starting");
    const listening = (
      await exec("lsof", [
        "-nP",
        "-a",
        "-p",
        pid,
        "-iTCP",
        "-sTCP:LISTEN",
      ]).catch(() => ({ stdout: "" }))
    ).stdout;
    return Number(listening.match(/127\.0\.0\.1:(\d+)/)?.[1] || debug);
  };
  instance.command = async (id, ...commandArgs) => {
    if (!instance.extensionPath)
      throw Error("Commands require the demo driver path");
    const expression = `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(instance.extensionPath, "driver.cjs"))})('vscode').commands.executeCommand(${[id, ...commandArgs].map((value) => JSON.stringify(value)).join(",")})`;
    return evaluate(await instance.debugPort(), expression);
  };
  try {
    await workbench(instance);
  } catch (error) {
    throw new Error(`${error.message}\nVS Code launch log:\n${log.slice(-6000)}`);
  }
  return instance;
}

async function makeFixture() {
  await mkdir(output, { recursive: true });
  const project = join(scratch, "relayboard-demo");
  const downloads = join(scratch, "Downloads");
  const origin = join(scratch, "relayboard-origin.git");
  const extension = join(scratch, "extension");
  const bin = join(scratch, "bin");
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(join(project, "test"), { recursive: true });
  await mkdir(downloads);
  await mkdir(extension);
  await mkdir(bin);
  await writeFile(
    join(project, "README.md"),
    "# Relayboard\n\nA tiny event router for GitHub notifications.\n",
  );
  await writeFile(
    join(project, "src", "notifications.ts"),
    `export type IssueEvent = {\n  action: "opened" | "closed";\n  title: string;\n  githubUrl: string;\n};\n\nexport function slackMessage(event: IssueEvent) {\n  return {\n    text: \`GitHub issue: \${event.title}\`,\n  };\n}\n`,
  );
  await writeFile(
    join(project, "src", "github.ts"),
    `export function isIssueEvent(type: string) {\n  return type === "issues";\n}\n`,
  );
  await writeFile(
    join(project, "test", "notifications.test.mjs"),
    `import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport test from "node:test";\n\ntest("Slack messages include the issue link", () => {\n  const source = readFileSync(new URL("../src/notifications.ts", import.meta.url), "utf8");\n  assert.match(source, /githubUrl/);\n  assert.match(source, /mrkdwn/);\n});\n`,
  );
  await writeFile(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: "relayboard-demo",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
      },
      null,
      2,
    ) + "\n",
  );
  await git(project, ["init", "-b", "main"]);
  await git(project, ["config", "user.name", "Lattice Demo"]);
  await git(project, ["config", "user.email", "demo@lattice.local"]);
  await git(project, ["add", "."]);
  await git(project, ["commit", "-m", "Create Relayboard sample"]);
  await git(scratch, ["init", "--bare", origin]);
  await git(project, ["remote", "add", "origin", origin]);
  await git(project, ["push", "-u", "origin", "main"]);
  const remote = "https://github.com/lattice-demo/relayboard-demo.git";
  await git(project, ["remote", "set-url", "origin", remote]);

  const packageJson = JSON.parse(await readFile(join(root, "package.json")));
  await writeFile(
    join(extension, "package.json"),
    JSON.stringify({ ...packageJson, main: "./driver.cjs" }, null, 2),
  );
  await cp(join(root, "dist"), join(extension, "dist"), { recursive: true });
  await cp(join(root, "media"), join(extension, "media"), { recursive: true });
  await copyFile(join(root, "LICENSE"), join(extension, "LICENSE"));
  await copyFile(join(root, "README.md"), join(extension, "README.md"));
  await writeFile(
    join(extension, "driver.cjs"),
    `const vscode = require("vscode");\nconst { join } = require("node:path");\nconst real = require("./dist/extension.cjs");\nexports.activate = async function (context) {\n  process.env.PATH = ${JSON.stringify(bin + ":")} + process.env.PATH;\n  await context.globalState.update("profile", { name: process.env.LATTICE_DEMO_NAME || "Developer" });\n  let ready = false;\n  context.subscriptions.push(vscode.commands.registerCommand("lattice.demo.state", async () => {\n    const uri = vscode.workspace.workspaceFolders?.[0]?.uri;\n    const proof = uri ? await context.secrets.get("session:" + uri.toString()) : undefined;\n    return { ready, root: uri?.fsPath, proof: proof && JSON.parse(proof) };\n  }));\n  context.subscriptions.push(vscode.commands.registerCommand("lattice.demo.clipboard", () => vscode.env.clipboard.readText()));\n  context.subscriptions.push(vscode.commands.registerCommand("lattice.demo.applyChange", async () => {\n    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;\n    if (!root) return;\n    const uri = vscode.Uri.file(join(root, "src", "notifications.ts"));\n    const source = \`export type IssueEvent = {\\n  action: "opened" | "closed";\\n  title: string;\\n  githubUrl: string;\\n};\\n\\nexport function slackMessage(event: IssueEvent) {\\n  return {\\n    text: \\\`GitHub issue: \\\${event.title}\\\`,\\n    blocks: [\\n      {\\n        type: "section",\\n        text: {\\n          type: "mrkdwn",\\n          text: \\\`*<\\\${event.githubUrl}|\\\${event.title}>*\\\`,\\n        },\\n      },\\n    ],\\n  };\\n}\\n\`;\n    await vscode.workspace.fs.writeFile(uri, Buffer.from(source));\n    const document = await vscode.workspace.openTextDocument(uri);\n    await vscode.window.showTextDocument(document);\n  }));\n  const result = await real.activate(context);\n  ready = true;\n  return result;\n};\nexports.deactivate = real.deactivate;\n`,
  );

  const vsix = join(downloads, `lattice-sync-${packageJson.version}.vsix`);
  await exec(
    join(root, "node_modules", ".bin", "vsce"),
    ["package", "--no-dependencies", "--out", vsix],
    { cwd: extension, maxBuffer: 8 * 1024 * 1024 },
  );
  await symlink(
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    join(bin, "code"),
  );
  const realGit = (await exec("which", ["git"])).stdout.trim();
  const gitShim = join(bin, "git");
  await writeFile(
    gitShim,
    `#!/bin/sh\nif [ "$1" = remote ] && [ "$2" = get-url ]; then exec ${JSON.stringify(realGit)} config --get remote.origin.url; fi\nexec ${JSON.stringify(realGit)} "$@"\n`,
  );
  await chmod(gitShim, 0o755);
  const gh = join(bin, "gh");
  await writeFile(
    gh,
    `#!/bin/sh\nset -eu\nstate="$LATTICE_DEMO_PR_STATE"\nsha=$(git rev-parse HEAD)\nif [ "$1 $2" = "auth status" ]; then echo "Logged in to github.com as lattice-demo"; exit 0; fi\nif [ "$1 $2" = "pr create" ]; then : > "$state"; echo "https://github.com/lattice-demo/relayboard-demo/pull/184"; exit 0; fi\nif [ "$1 $2" = "pr list" ]; then\n  if [ -f "$state" ]; then printf '[{"number":184,"url":"https://github.com/lattice-demo/relayboard-demo/pull/184","state":"OPEN","headRefOid":"%s","baseRefName":"main"}]\\n' "$sha"; else printf '[]\\n'; fi\n  exit 0\nfi\nif [ "$1 $2" = "pr view" ]; then printf '{"number":184,"url":"https://github.com/lattice-demo/relayboard-demo/pull/184","state":"OPEN","headRefOid":"%s","baseRefName":"main"}\\n' "$sha"; exit 0; fi\necho "Unsupported demo gh command: $*" >&2\nexit 1\n`,
  );
  await chmod(gh, 0o755);
  return { project, downloads, origin, remote, extension, bin, vsix };
}

async function render() {
  const concat = join(output, "timeline.txt");
  const lines = [];
  for (const shot of shots) {
    lines.push(`file '${shot.path.replaceAll("'", "'\\''")}'`);
    lines.push(`duration ${shot.seconds}`);
  }
  lines.push(`file '${shots.at(-1).path.replaceAll("'", "'\\''")}'`);
  await writeFile(concat, lines.join("\n") + "\n");
  await exec(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "warning",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concat,
      "-vf",
      "scale=2560:1120:force_original_aspect_ratio=decrease,pad=2560:1440:(ow-iw)/2:(oh-ih)/2:black,fps=25,format=yuv420p",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      movie,
    ],
    { maxBuffer: 8 * 1024 * 1024, timeout: 300000 },
  );
  const manifest = {
    file: movie,
    source: "native Visual Studio Code workbench",
    width: 2560,
    height: 1440,
    fps: 25,
    audio: false,
    content: { width: 2560, height: 1120, topBand: 160, bottomBand: 160 },
    scenes: shots.map(({ name, seconds }) => ({ name, seconds })),
    fixture: {
      repo: "relayboard-demo",
      relay: "local",
      pullRequest: "local gh fixture #184",
    },
  };
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

export { makeFixture, launch, workbench, frameWith, frameWithButton, until, evaluate, freePort, scratch, browsers, children };

if (process.argv[1] === new URL(import.meta.url).pathname) try {
  const fixture = await makeFixture();
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${fixture.origin}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = fixture.remote;
  const relayPort = await freePort();
  const host = await launch(
    "host",
    fixture.project,
    fixture.extension,
    "Maya",
    relayPort,
    fixture.bin,
  );
  let hostPage = await workbench(host);
  await until(async () => (await host.command("lattice.demo.state"))?.ready, "Host extension activation");

  await host.command("workbench.action.quickOpen");
  const initialFile = hostPage.locator(".quick-input-widget input").last();
  await initialFile.fill("notifications.ts");
  await hostPage.keyboard.press("Enter");
  await delay(700);
  await capture(hostPage, "host-sample-workspace", 2.4);
  let hostFrame = await latticeActivity(hostPage, "host-open-lattice");
  await capture(hostPage, "host-lattice-dashboard", 2.2);
  await hostFrame.getByRole("button", { name: "New session", exact: true }).click();
  await hostFrame.getByRole("textbox", { name: "What are you building?" }).waitFor();
  await capture(hostPage, "host-new-session", 1.8);
  await hostFrame.getByRole("textbox", { name: "What are you building?" }).fill("GitHub issue alerts");
  const slider = hostFrame.getByRole("slider", { name: "AI coordination strictness" });
  await slider.focus();
  await capture(hostPage, "host-strictness-six", 1.4);
  await slider.press("End");
  await slider.press("ArrowLeft");
  await slider.press("ArrowLeft");
  assert.equal(await slider.inputValue(), "8");
  await capture(hostPage, "host-strictness-eight", 2.0);
  await hostFrame.getByRole("button", { name: /Start session/ }).hover();
  await capture(hostPage, "host-create-ready", 1.2);
  await hostFrame.getByRole("button", { name: /Start session/ }).click();
  const hosted = await until(async () => {
    const state = await host.command("lattice.demo.state");
    return state?.ready && state.proof && state.root !== fixture.project && state;
  }, "Host workspace teleport", 90000);
  relayPid = Number(
    (await exec("lsof", ["-ti", `TCP:${relayPort}`, "-sTCP:LISTEN"]))
      .stdout.trim()
      .split("\n")[0],
  );
  hostPage = await workbench(host);
  await host.command("lattice.open");
  hostFrame = await frameWithButton(hostPage, "Invite");
  await capture(hostPage, "host-session-workspace", 3.0);
  await hostFrame.getByRole("button", { name: "Invite", exact: true }).click();
  await hostFrame.getByRole("button", { name: "Copy invitation", exact: true }).waitFor();
  await capture(hostPage, "host-invite", 1.8);
  await hostFrame.getByRole("button", { name: "Copy invitation", exact: true }).click();
  const invitation = await until(
    async () => {
      const value = await host.command("lattice.demo.clipboard");
      return String(value).startsWith("vscode://") ? value : undefined;
    },
    "Invitation clipboard",
  );
  await hostPage.keyboard.press("Escape");

  const guest = await launch(
    "guest",
    fixture.downloads,
    undefined,
    "Noah",
    relayPort,
    fixture.bin,
  );
  let guestPage = await workbench(guest);
  await capture(guestPage, "guest-downloaded-vsix", 2.2);
  const installEnv = { ...process.env };
  delete installEnv.ELECTRON_RUN_AS_NODE;
  await exec(
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    [
      "--install-extension",
      fixture.vsix,
      `--user-data-dir=${guest.profile}`,
      `--extensions-dir=${guest.extensions}`,
      "--force",
    ],
    { env: installEnv, timeout: 60000 },
  );
  const installed = await until(async () => {
    const folders = await readdir(guest.extensions);
    return folders.find((name) =>
      name.startsWith("harshaldhaduk.lattice-sync-"),
    );
  }, "VSIX installation", 60000);
  guest.extensionPath = join(guest.extensions, installed);
  await delay(1600);
  await capture(guestPage, "guest-extension-installed", 2.4);
  await guest.command("workbench.action.reloadWindow").catch(() => {});
  await delay(1800);
  guestPage = await workbench(guest);
  let guestFrame = await latticeActivity(guestPage, "guest-open-lattice");
  await capture(guestPage, "guest-lattice-dashboard", 1.8);
  await guestFrame.getByRole("button", { name: "Join session", exact: true }).click();
  await guestFrame.getByRole("textbox", { name: "Invitation link" }).fill(invitation);
  await capture(guestPage, "guest-join-invitation", 2.0);
  await guestFrame.getByRole("button", { name: "Join live work", exact: true }).hover();
  await capture(guestPage, "guest-join-ready", 1.2);
  await guestFrame.getByRole("button", { name: "Join live work", exact: true }).click();
  await delay(350);
  await capture(guestPage, "guest-teleporting", 1.6);
  await until(async () => {
    guestPage = await workbench(guest);
    if ((await guestPage.title()).includes("Downloads")) return false;
    for (const frame of guestPage.frames()) {
      if (!frame.url().startsWith("vscode-webview://")) continue;
      const body = await frame.locator("body").innerText().catch(() => "");
      if (body.includes("GitHub issue alerts")) return true;
    }
    return false;
  }, "Guest workspace teleport", 90000);
  guestPage = await workbench(guest);
  guestFrame = await frameWith(guestPage, "GitHub issue alerts");
  await capture(guestPage, "guest-arrived-in-codebase", 3.2);

  await host.command("lattice.demo.applyChange");
  await delay(1400);
  hostPage = await workbench(host);
  await capture(hostPage, "host-implementation", 3.0);
  await delay(1800);
  await guest.command("workbench.action.quickOpen");
  const quick = guestPage.locator(".quick-input-widget input").last();
  await quick.fill("notifications.ts");
  await guestPage.keyboard.press("Enter");
  await delay(900);
  await capture(guestPage, "guest-shared-code", 2.8);

  hostFrame = await frameWithButton(hostPage, "Return to project");
  await hostFrame.getByRole("button", { name: /Return to project/ }).click();
  const leave = hostPage.locator(".quick-input-widget");
  await leave.waitFor({ state: "visible" });
  await capture(hostPage, "host-finish-session", 2.3);
  await hostPage.getByText("Create a pull request", { exact: true }).click();
  const titleWidget = hostPage
    .locator(".quick-input-widget")
    .filter({ hasText: "Pull request title" });
  await titleWidget.waitFor({ state: "visible", timeout: 90000 });
  const titleInput = titleWidget.locator("input");
  await titleInput.fill("Send GitHub issue alerts to Slack");
  await capture(hostPage, "host-pr-title", 1.8);
  await hostPage.keyboard.press("Enter");
  const publish = hostPage.getByRole("button", { name: "Publish PR", exact: true });
  await publish.waitFor({ state: "visible", timeout: 90000 });
  await capture(hostPage, "host-pr-review", 3.8);
  await publish.click();
  await until(async () => {
    hostPage = await workbench(host);
    return (await hostPage.title()).includes("relayboard-demo");
  }, "Return to original project", 90000);
  await delay(1200);
  const dashboard = await latticeActivity(hostPage);
  await dashboard.getByText("PR #184", { exact: true }).waitFor({ timeout: 60000 });
  await capture(hostPage, "host-pull-request", 5.0);

  assert.notEqual(hosted.root, fixture.project);
  await render();
  console.log(JSON.stringify({ file: movie, shots: shots.length, scratch }, null, 2));
} catch (error) {
  console.error(error);
  for (const browser of browsers) {
    for (const page of browser.contexts()[0]?.pages() || []) {
      const title = await page.title().catch(() => "");
      const body = await page.locator("body").innerText().catch(() => "");
      console.error(`\n--- ${title} ---\n${body.slice(-4000)}`);
    }
  }
  throw error;
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of children) child.kill();
  if (relayPid)
    try {
      process.kill(relayPid, "SIGTERM");
    } catch {}
}
