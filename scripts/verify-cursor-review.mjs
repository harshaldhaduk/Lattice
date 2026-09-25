import { build } from "esbuild";
import { chromium } from "playwright-core";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (file) =>
  JSON.parse(await readFile(file, "utf8").catch(() => "null"));
const scratch = await mkdtemp(join(tmpdir(), "lattice-cursor-review-"));
const root = join(scratch, "workspace");
await mkdir(root);
await mkdir("artifacts/cursor-review", { recursive: true });
await build({
  entryPoints: ["test/vscode-cursor-review.ts"],
  outfile: "dist/vscode-cursor-review-test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  define: { navigator: "undefined" },
});
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const env = {
  ...process.env,
  LATTICE_CURSOR_CODEX:
    process.env.LATTICE_CURSOR_CODEX ||
    join(process.env.HOME, ".npm-global/bin/codex"),
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  [
    `--user-data-dir=${join(scratch, "profile")}`,
    `--extensions-dir=${join(scratch, "extensions")}`,
    `--extensionDevelopmentPath=${resolve(".")}`,
    `--extensionTestsPath=${resolve("dist/vscode-cursor-review-test.cjs")}`,
    `--remote-debugging-port=${port}`,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    root,
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
let browser;
const measurements = [];
let lastCapture = 0;
let reported = false;
try {
  for (let i = 0; i < 100 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await pause(300);
    }
  }
  assert.ok(browser);
  const deadline = Date.now() + 165000;
  while (Date.now() < deadline) {
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("workbench"));
    const phase = await json(join(root, ".cursor-review", "phase.json")).catch(
      () => null,
    );
    const frame =
      page
        ?.frames()
        .find(
          (f) =>
            f.url().includes("vscode-webview") && f.url().includes("fake.html"),
        ) ||
      (await (async () => {
        for (const f of page?.frames() || [])
          if (await f.locator(".live-code-sheet").count()) return f;
      })());
    const result = await json(
      join(root, ".cursor-review", "provider-result.json"),
    ).catch(() => null);
    if (result && !reported) {
      console.log("Provider run: " + JSON.stringify(result));
      reported = true;
    }
    if (
      page &&
      Date.now() - lastCapture > 3500 &&
      phase?.phase === "real-prompt"
    ) {
      lastCapture = Date.now();
      await page.screenshot({
        path: resolve(`artifacts/cursor-review/prompt-${lastCapture}.png`),
      });
      console.log("Observed real prompt frame");
    }
    if (
      frame &&
      phase?.phase === "fixture" &&
      !measurements.some((m) => m.step === phase.step)
    ) {
      await pause(300);
      const m = await frame.evaluate(() => {
        const footer = document.querySelector(
          ".live-editor-footer",
        ).textContent;
        const [, line, col] = footer.match(/Ln (\d+), Col (\d+)/);
        const code = document.querySelectorAll(".live-code-line code")[
          Number(line) - 1
        ];
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let n,
          left = Number(col) - 1;
        let expected;
        while ((n = walker.nextNode())) {
          if (left <= n.textContent.length) {
            const r = document.createRange();
            r.setStart(n, left);
            r.collapse(true);
            expected = r.getBoundingClientRect();
            break;
          }
          left -= n.textContent.length;
        }
        const caret = document
          .querySelector(".live-caret")
          .getBoundingClientRect();
        const row = code.parentElement.getBoundingClientRect();
        return {
          line: Number(line),
          column: Number(col),
          dx: Math.abs(caret.x - expected.x),
          dy: Math.abs(caret.y - row.y),
          rowHeight: row.height,
          codeBackground: getComputedStyle(code).backgroundColor,
          codePadding: getComputedStyle(code).padding,
        };
      });
      assert.ok(m.dx < 1.5 && m.dy < 1.5, JSON.stringify(m));
      assert.equal(m.codePadding, "0px");
      measurements.push({ step: phase.step, ...m });
      if ([1, 6, 9, 16, 20].includes(phase.step))
        await page.screenshot({
          path: resolve(
            `artifacts/cursor-review/native-line-${phase.step}.png`,
          ),
        });
      await writeFile(
        join(root, ".cursor-review", "continue"),
        String(phase.step),
      );
    }
    const done = await json(join(root, ".cursor-review", "result.json")).catch(
      () => null,
    );
    if (done) {
      assert.equal(measurements.length, 20);
      await writeFile(
        "artifacts/cursor-review/native-result.json",
        JSON.stringify({ ...done, measurements, scratch }, null, 2),
      );
      console.log("LATTICE_CURSOR_REVIEW_OK " + JSON.stringify(done));
      break;
    }
    await pause(100);
  }
  assert.equal(measurements.length, 20, "All 20 cursor positions observed");
} catch (e) {
  console.error(output.slice(-4000));
  throw e;
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  console.log("Fixture: " + scratch);
}
