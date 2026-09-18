const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1300, height: 850 },
    });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const person = (id, name, role) => ({
      id,
      name,
      role,
      color: "#a7c7e7",
      online: true,
      usage: { input: 0, output: 0 },
    });
    const life = {
      baseBranch: "main",
      baseCommit: "a".repeat(40),
      remote: "https://github.com/team/project.git",
      status: "active",
    };
    const session = {
      id: "one",
      title: "Multiplayer lobby",
      repo: "team/project",
      branch: "session/lobby",
      lifecycle: life,
      created: Date.now(),
      revision: 1,
      people: [
        person("me", "You", "owner"),
        {
          ...person("bro", "Brother", "editor"),
          agent: {
            runId: "bro-run",
            provider: "claude",
            status: "running",
            task: "Build lobby API",
            detail: "Editing lobby.ts",
          },
        },
      ],
      entries: [],
      plan: [],
      comments: [],
      memories: [],
      approvals: [],
      handoffs: [],
    };
    const card = (id, title, status) => ({
      ...session,
      id,
      title,
      people: session.people,
      lifecycle: { ...life, status },
      archived: status === "merged",
      completed: 1,
      steps: 3,
      pending: 0,
    });
    let mode = "dashboard";
    let state = {
      me: "me",
      connected: true,
      repo: session.repo,
      branch: session.branch,
      providers: [
        { id: "codex", available: true },
        { id: "claude", available: true },
      ],
      session,
      dashboard: [
        card("one", "Multiplayer lobby", "active"),
        card("two", "Player invites", "review"),
        card("three", "Matchmaking", "merged"),
      ],
    };
    await page.route("**/preview.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.LATTICE_MODE=${JSON.stringify(mode)};window.LATTICE_PREVIEW=${JSON.stringify(state)};window.actions=[];window.addEventListener('previewAction',e=>window.actions.push(e.detail));`,
      }),
    );
    await page.goto(process.env.PREVIEW_URL || "http://127.0.0.1:4327");
    await page.getByRole("heading", { name: "Your sessions" }).waitFor();
    assert.equal(await page.locator(".session-tile").count(), 2);
    await page
      .getByRole("textbox", { name: "Search sessions" })
      .fill("invites");
    assert.equal(await page.locator(".session-tile").count(), 1);
    await page.getByRole("textbox", { name: "Search sessions" }).fill("");
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await page
      .getByRole("heading", { name: "Matchmaking", exact: true })
      .waitFor();
    assert.equal(await page.locator(".session-tile").count(), 1);
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await page
      .getByRole("button", { name: "New session", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "What are you building?" })
      .fill("Player profiles");
    await page
      .getByRole("button", { name: "Start session", exact: false })
      .click();
    assert.ok(
      await page.evaluate(() =>
        window.actions.some(
          (a) => a.type === "host" && a.title === "Player profiles",
        ),
      ),
    );
    await page.screenshot({
      path: "artifacts/session-dashboard.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 480, height: 800 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    mode = "composer";
    await page.setViewportSize({ width: 950, height: 280 });
    await page.reload();
    const input = page.getByRole("textbox", { name: "Prompt your agent" });
    await input.fill("My unfinished prompt");
    await page
      .getByRole("combobox", { name: "Agent conversation" })
      .selectOption("bro");
    await page.getByText("Guiding Brother", { exact: false }).waitFor();
    assert.equal(await input.inputValue(), "");
    await input.fill("Use the shared schema");
    await page
      .getByRole("button", { name: "Send guidance", exact: true })
      .click();
    assert.ok(
      await page.evaluate(() =>
        window.actions.some(
          (a) =>
            a.event?.type === "guidance.send" &&
            a.event.runId === "bro-run" &&
            a.event.text === "Use the shared schema",
        ),
      ),
    );
    await page.getByRole("button", { name: "My agent", exact: true }).click();
    assert.equal(await input.inputValue(), "My unfinished prompt");
    assert.equal(
      await page
        .getByRole("combobox", { name: "Agent permission mode" })
        .isVisible(),
      false,
    );
    const send = await page
      .getByRole("button", { name: "Send prompt", exact: true })
      .boundingBox();
    assert.ok(send && send.y + send.height <= 280);
    mode = "sidebar";
    state = {
      ...state,
      session: {
        ...session,
        guidance: [
          {
            id: "g",
            from: "bro",
            to: "me",
            runId: "my-run",
            action: "steer",
            text: "Use the shared schema",
            status: "approval",
          },
        ],
        handoffs: [
          {
            id: "h",
            from: "bro",
            to: "",
            reason: "limit",
            status: "pending",
            task: "Finish lobby",
          },
        ],
      },
    };
    await page.setViewportSize({ width: 370, height: 850 });
    await page.reload();
    await page
      .getByRole("button", { name: "Allow guidance", exact: true })
      .click();
    assert.ok(
      await page.evaluate(() =>
        window.actions.some(
          (a) => a.event?.type === "guidance.decide" && a.event.approve,
        ),
      ),
    );
    await page
      .getByRole("button", {
        name: "Continue this task · your account",
        exact: true,
      })
      .click();
    assert.ok(
      await page.evaluate(() =>
        window.actions.some((a) => a.type === "receiveHandoff" && a.id === "h"),
      ),
    );
    assert.equal(
      await page.getByRole("button", { name: /Conflict sensitivity/ }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "dashboard filtering and branch creation",
          "responsive cards",
          "Claude teammate steering",
          "per-lane draft retention",
          "compact composer",
          "owner approval card",
          "one-click provider handoff",
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
