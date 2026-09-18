import { build } from "esbuild";
import { chromium } from "playwright-core";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  } // A phase file can be observed between truncate and write.
};
const root = resolve(".");
const scratch = await mkdtemp(join(tmpdir(), "lattice-native-presence-"));
const workspace = join(scratch, "workspace");
await mkdir(workspace);
await mkdir(resolve("artifacts"), { recursive: true });
await build({
  entryPoints: ["test/vscode-presence.ts"],
  outfile: "dist/vscode-presence-test.cjs",
  platform: "node",
  format: "cjs",
  bundle: true,
  external: ["vscode"],
  define: { navigator: "undefined" },
});
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.env.VSCODE_EXECUTABLE ||
    "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  [
    `--user-data-dir=${join(scratch, "profile")}`,
    `--extensions-dir=${join(scratch, "extensions")}`,
    `--extensionDevelopmentPath=${root}`,
    `--extensionTestsPath=${resolve("dist/vscode-presence-test.cjs")}`,
    `--remote-debugging-port=${port}`,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    workspace,
  ],
  { stdio: ["ignore", "pipe", "pipe"], env: childEnv },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
let browser;
try {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await pause(400);
    }
  }
  assert.ok(browser, "VS Code debugging endpoint available");
  let page;
  while (Date.now() < deadline) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes("workbench"));
    if (page) break;
    await pause(200);
  }
  assert.ok(page, "Native VS Code workbench opened");
  const positions = () =>
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll(".monaco-editor .view-lines span"),
      ).flatMap((el) => {
        const after = getComputedStyle(el, "::after");
        if (!after.content.includes("avatars")) return [];
        const rect = el.getBoundingClientRect();
        const line = el.closest(".view-line");
        return [
          {
            x: rect.x,
            y: rect.y,
            content: after.content,
            line: line?.textContent,
            margin: after.margin,
            width: after.width,
          },
        ];
      }),
    );
  const observed = new Map();
  const handled = new Set();
  const end = Date.now() + 65000;
  let result;
  while (Date.now() < end) {
    const phase = (await readJSON(join(workspace, "phase.json")))?.phase;
    if (phase === "moving") {
      for (const p of await positions()) observed.set(`${p.x}:${p.y}`, p);
    } else if (phase && !handled.has(phase)) {
      const markers = await positions();
      if (["hidden", "offline"].includes(phase))
        assert.equal(markers.length, 0, `No stale markers during ${phase}`);
      else
        assert.ok(markers.length > 0, `Native avatar rendered during ${phase}`);
      if (phase === "initial") {
        await page.screenshot({
          path: resolve("artifacts/native-presence-before.png"),
        });
        const baselines = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll(".monaco-editor .view-lines .view-line"),
          )
            .slice(0, 6)
            .map((line) => {
              const walker = document.createTreeWalker(
                line,
                NodeFilter.SHOW_TEXT,
              );
              const text = walker.nextNode();
              const range = document.createRange();
              range.selectNodeContents(text);
              return range.getBoundingClientRect().y;
            }),
        );
        const spacing = baselines[1] - baselines[0];
        for (let i = 2; i < baselines.length; i++)
          assert.ok(
            Math.abs(baselines[i] - baselines[i - 1] - spacing) < 1,
            "Avatar must not shift text baselines: " +
              JSON.stringify(baselines),
          );
        await page.screenshot({
          path: resolve("artifacts/native-presence-before.png"),
        });
      }
      if (phase === "agent") {
        assert.ok(
          markers.every((marker) => marker.line.includes("value08")),
          "Native avatar follows agent document position",
        );
        await page.screenshot({
          path: resolve("artifacts/native-presence-agent.png"),
        });
      }
      if (phase === "moved") {
        assert.ok(
          observed.size >= 5,
          `Expected intermediate native positions, saw ${observed.size}`,
        );
        await page.screenshot({
          path: resolve("artifacts/native-presence-after.png"),
        });
      }
      handled.add(phase);
      await writeFile(join(workspace, "continue"), phase);
    }
    result = await readJSON(join(workspace, "result.json"));
    if (result) break;
    await pause(20);
  }
  assert.ok(result?.passed, "Native extension-host checks completed");
  result.distinctRenderedPositions = observed.size;
  result.visualPhases = [...handled];
  result.scratch = scratch;
  await writeFile(
    resolve("artifacts/native-presence-test.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(output.slice(-8000));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  child.kill();
}
