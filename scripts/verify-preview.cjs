const { chromium } = require("playwright-core");
let browser;
(async () => {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.PREVIEW_URL || "http://127.0.0.1:4320");
  await page.getByRole("button", { name: /Conflict sensitivity/ }).click();
  const sensitivity = page.getByRole("slider", {
    name: "Conflict sensitivity",
  });
  await sensitivity.press("Home");
  await sensitivity.press("ArrowRight");
  if ((await sensitivity.inputValue()) !== "2")
    throw Error("Conflict sensitivity slider did not update");
  await page.getByRole("button", { name: "Save preference" }).click();
  await page
    .getByRole("button", { name: /Conflict sensitivity/ })
    .getByText("2/10")
    .waitFor();
  await page
    .getByRole("heading", { name: "One composer. Your connected agents." })
    .count();
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../artifacts/workspace-preview.png",
    ),
    fullPage: true,
  });
  await page.getByRole("button", { name: "PLAN", exact: false }).click();
  await page
    .getByRole("textbox", { name: "New plan step" })
    .fill("Verify invitation flow");
  await page.getByRole("button", { name: "Add plan step" }).click();
  await page
    .getByRole("checkbox", { name: "Complete Verify invitation flow" })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Complete Verify invitation flow"]')
        .checked,
  );
  await page
    .getByRole("combobox", { name: "AI provider" })
    .selectOption("claude");
  await page
    .getByRole("textbox", { name: "Prompt your agent" })
    .fill("Review the session architecture");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await page
    .getByText("This is an interactive UI preview.", { exact: false })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Prompt your agent" })
    .fill("Keep this draft");
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Prompt your agent"]').value ===
      "Keep this draft",
  );
  await page
    .getByRole("button", { name: "Invite", exact: true })
    .last()
    .click();
  await page.getByRole("dialog", { name: "Invite to session" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Return to project" }).click();
  await page.getByRole("button", { name: "Join with an invite" }).click();
  await page
    .getByText("The host’s live workspace opens", { exact: false })
    .waitFor();
  await page.getByRole("slider", { name: "Conflict sensitivity" }).waitFor();
  await page.screenshot({
    animations: "disabled",
    path: require("node:path").resolve(
      __dirname,
      "../artifacts/join-live-workspace.png",
    ),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start a session" }).click();
  await page.getByLabel("What are you building?").fill("Review session");
  await page.getByRole("button", { name: "Create session" }).click();
  await page.getByText("Review session", { exact: true }).first().waitFor();
  await page.reload();
  await page.getByRole("textbox", { name: "Prompt your agent" }).waitFor();
  await page.setViewportSize({ width: 900, height: 240 });
  await page.evaluate(() => {
    window.LATTICE_MODE = "composer";
    window.postMessage(
      { type: "state", state: window.LATTICE_PREVIEW },
      location.origin,
    );
  });
  await page.waitForTimeout(100);
  const bounds = await page
    .getByRole("button", { name: "Send prompt", exact: true })
    .boundingBox();
  if (!bounds || bounds.y + bounds.height > 240)
    throw Error("Composer submit button is clipped in a short native panel");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      errors,
      checks: [
        "conflict sensitivity slider and saved preference",
        "live workspace join onboarding",
        "plan add/complete",
        "provider selection",
        "prompt submit",
        "draft survives reload",
        "invite modal and keyboard dismissal",
        "leave and host",
        "short bottom panel layout",
      ],
    }),
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
