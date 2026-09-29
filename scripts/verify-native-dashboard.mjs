// Exercise actual VS Code theme injection in a disposable extension-host profile.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  makeFixture,
  launch,
  workbench,
  frameWith,
  until,
  evaluate,
  freePort,
  browsers,
  children,
} from "./demo/native-record.mjs";

const out = resolve("artifacts/native-dashboard-0.5.11");
// Use the harness's native-window launch path (no emulated viewport/capture).
process.env.LATTICE_RECORDLY = "1";
await mkdir(out, { recursive: true });
try {
  const fixture = await makeFixture();
  const host = await launch(
    "qa", // Keep the profile path below macOS's Unix-socket length limit.
    fixture.project,
    fixture.extension,
    "Dashboard QA",
    await freePort(),
    fixture.bin,
  );
  const page = await workbench(host);
  await until(
    async () => (await host.command("lattice.demo.state"))?.ready,
    "Extension ready",
  );
  await host.command("lattice.dashboard");
  await host.command("workbench.action.closePanel");
  const frame = await frameWith(page, "Your sessions");
  const tabs = frame.getByRole("group", { name: "Session status" });
  const api = `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(host.extensionPath, "driver.cjs"))})('vscode')`;
  const results = [];
  for (const [theme, themeClass] of [
    ["Default Dark Modern", "vscode-dark"],
    ["Default Light Modern", "vscode-light"],
    ["Default High Contrast", "vscode-high-contrast"],
  ]) {
    await evaluate(
      await host.debugPort(),
      `(${api}).workspace.getConfiguration('workbench').update('colorTheme',${JSON.stringify(theme)},true)`,
    );
    await until(
      () =>
        frame
          .locator("body")
          .evaluate((body, name) => body.classList.contains(name), themeClass),
      "Native theme " + theme,
    );
    for (const name of ["Active", "Completed"]) {
      const button = frame.getByRole("button", { name, exact: true });
      await button.click();
      await page.waitForTimeout(350);
      const style = await tabs.evaluate((el) => ({
        background: getComputedStyle(el, "::before").backgroundColor,
        foreground: getComputedStyle(el.querySelector('[aria-pressed="true"]'))
          .color,
        editorAccent: getComputedStyle(document.body)
          .getPropertyValue("--vscode-list-activeSelectionBackground")
          .trim(),
        editorBackground: getComputedStyle(document.body)
          .getPropertyValue("--vscode-editor-background")
          .trim(),
        transform: getComputedStyle(el, "::before").transform,
      }));
      assert.equal(
        style.background,
        "rgb(48, 48, 52)",
        theme + " selected highlight",
      );
      assert.equal(
        style.foreground,
        "rgb(255, 255, 255)",
        theme + " selected label",
      );
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.ok(
        style.editorBackground,
        "Test must have real VS Code theme variables",
      );
      // High Contrast intentionally omits the filled list-selection token.
      if (themeClass !== "vscode-high-contrast") assert.ok(style.editorAccent);
      if (name === "Completed")
        assert.notEqual(style.transform, "matrix(1, 0, 0, 1, 0, 0)");
      const active = await frame
        .getByRole("button", { name: "Active", exact: true })
        .boundingBox();
      const completed = await frame
        .getByRole("button", { name: "Completed", exact: true })
        .boundingBox();
      assert.ok(
        completed.x - active.x - active.width >= 11.5,
        "Preserve tab spacing",
      );
      await button.press("Tab");
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await button.evaluate((el) => el.matches(":focus-visible")),
        true,
      );
      assert.equal(
        await button.evaluate((el) => getComputedStyle(el).outlineColor),
        "rgb(255, 255, 255)",
      );
      await page.screenshot({
        path: join(out, `${themeClass}-${name.toLowerCase()}.png`),
      });
      results.push({ theme, selected: name, ...style });
    }
  }
  await writeFile(
    join(out, "results.json"),
    JSON.stringify({ passed: true, results }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, checks: results.length, results }),
  );
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of children) child.kill();
}
