const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL || "http://127.0.0.1:4320");
    await page
      .getByRole("button", { name: "Follow live edits" })
      .first()
      .click();
    await page.getByText("SAMPLE EDIT PLAYBACK", { exact: true }).waitFor();
    const cursor = page.getByTestId("live-agent-cursor");
    await cursor.waitFor();
    await page.waitForTimeout(300);
    const before = await cursor.boundingBox();
    await page.waitForTimeout(900);
    const after = await cursor.boundingBox();
    assert.ok(
      before && after && before.y !== after.y,
      "Agent cursor moves with incoming file edits",
    );
    const transition = await cursor.evaluate(
      (el) => getComputedStyle(el).transitionProperty,
    );
    assert.ok(
      transition.includes("transform"),
      "Cursor uses transform interpolation",
    );
    await page
      .getByText("expectedRevision", { exact: false })
      .first()
      .waitFor();
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/live-agent-view.png"),
    });
    await page.getByRole("button", { name: "Pause following" }).click();
    await page.getByRole("button", { name: "Follow cursor" }).waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await cursor.evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await page.getByRole("button", { name: "Back to workspace" }).click();
    await page
      .getByRole("button", { name: "Follow live edits" })
      .first()
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "file updates visible",
          "cursor position follows edits",
          "smooth transform transition",
          "pause/resume following",
          "reduced motion",
          "return to workspace",
        ],
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
