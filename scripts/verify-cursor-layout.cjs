const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const results = [];
  try {
    for (const mode of ["sidebar", "composer", "dashboard"])
      for (const width of mode === "sidebar" ? [280, 375, 520] : [375, 1000]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("http://127.0.0.1:4340/", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html><head><link rel="stylesheet" href="/webview.css"></head><body><div id="root"></div><script src="/preview.js"></script><script>window.LATTICE_MODE='${mode}';window.LATTICE_PREVIEW.preview=false;</script><script src="/webview.js"></script></body></html>`,
          }),
        );
        await page.goto("http://127.0.0.1:4340/");
        await page.waitForTimeout(350);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        assert.equal(overflow, false, `${mode} ${width} page overflow`);
        if (mode === "sidebar") {
          const action = page
            .getByRole("button", { name: "Follow live edits" })
            .first();
          await action.waitFor();
          assert.equal(
            await action.evaluate((el) => !!el.closest(".agent-card")),
            true,
          );
          assert.equal(
            await action.evaluate((el) => !!el.parentElement.closest("button")),
            false,
          );
          await action.focus();
          assert.equal(
            await action.evaluate((el) => getComputedStyle(el).outlineStyle),
            "solid",
          );
        }
        await page.screenshot({
          path: `artifacts/cursor-review/${mode}-${width}.png`,
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        results.push({ mode, width, overflow });
        await page.close();
      }
    // Real DOM coordinates at different fonts and zoom, including tabs and Unicode.
    const page = await browser.newPage({
      viewport: { width: 540, height: 600 },
    });
    await page.goto("http://127.0.0.1:4340/");
    await page.evaluate(() => {
      window.LATTICE_MODE = "live";
      const s = window.LATTICE_PREVIEW;
      s.following = "bob";
      s.preview = false;
      s.session.documents = [
        {
          key: "main:check.ts",
          file: "check.ts",
          author: "bob",
          runId: "check",
          provider: "codex",
          version: 1,
          content: '\tconst wide = "漢字 🙂 ffi";\n',
          line: 0,
          column: 26,
          updated: Date.now(),
        },
      ];
      window.postMessage({ type: "state", state: s }, "*");
    });
    for (const zoom of [1, 1.25, 1.75]) {
      await page.evaluate((zoom) => {
        document.body.style.zoom = zoom;
        document.querySelector(".live-code-sheet").style.font =
          "17px/31px monospace";
      }, zoom);
      await page.waitForTimeout(400);
      const pos = await page.evaluate(() => {
        const code = document.querySelector(".live-code-line code"),
          text = code.textContent;
        const range = document.createRange();
        let left = Math.min(26, text.length);
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (left <= n.textContent.length) {
            range.setStart(n, left);
            break;
          }
          left -= n.textContent.length;
        }
        range.collapse(true);
        const expected = range.getBoundingClientRect(),
          actual = document
            .querySelector(".live-caret")
            .getBoundingClientRect(),
          row = code.parentElement.getBoundingClientRect();
        return {
          dx: Math.abs(actual.x - expected.x),
          dy: Math.abs(actual.y - row.y),
        };
      });
      assert.ok(pos.dx < 1.5 && pos.dy < 1.5, JSON.stringify({ zoom, ...pos }));
      results.push({ zoom, ...pos });
    }
    await page.screenshot({ path: "artifacts/cursor-review/zoom-cursor.png" });
    fs.writeFileSync(
      "artifacts/cursor-review/layout-result.json",
      JSON.stringify(results, null, 2),
    );
    console.log("LATTICE_CURSOR_LAYOUT_OK", JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
