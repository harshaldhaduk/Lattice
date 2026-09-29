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
      viewport: { width: 1024, height: 850 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const state = {
      me: "me",
      connected: true,
      repo: "demo",
      branch: "main",
      providers: [
        { id: "codex", available: true },
        { id: "claude", available: true },
      ],
      dashboard: [],
    };
    await page.route("**/preview.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.LATTICE_MODE='dashboard';window.LATTICE_PREVIEW=${JSON.stringify(state)};window.actions=[];window.addEventListener('previewAction',e=>window.actions.push(e.detail));`,
      }),
    );
    await page.goto(process.env.PREVIEW_URL || "http://127.0.0.1:4332");
    const update = async (error, mode = "dashboard") => {
      await page.evaluate(
        ({ state, error, mode }) => {
          window.LATTICE_MODE = mode;
          window.postMessage(
            { type: "state", state: { ...state, error } },
            location.origin,
          );
        },
        { state, error, mode },
      );
    };
    const button = (name) => page.getByRole("button", { name, exact: true });
    await button("New session").click();
    await page.locator(".dashboard-create").waitFor();
    const nameField = page.getByRole("textbox", {
      name: "What are you building?",
    });
    await nameField.focus();
    const trace = nameField.locator("..").locator(".perimeter-line");
    const origin = await trace.evaluate((e) => {
      const p = e.getPointAtLength(0),
        next = e.getPointAtLength(4),
        frame = e.closest(".focus-frame");
      return {
        x: p.x,
        y: p.y,
        nextX: next.x,
        width: frame.offsetWidth,
        height: frame.offsetHeight,
      };
    });
    assert.ok(
      Math.abs(origin.x - origin.width / 2) < 1 &&
        Math.abs(origin.y - origin.height + 0.75) < 1,
      "Start at the bottom midpoint",
    );
    assert.ok(
      origin.nextX < origin.x,
      "Clockwise from bottom center heads left first",
    );
    assert.equal(
      await trace.evaluate((e) => getComputedStyle(e).stroke),
      "rgb(255, 255, 255)",
    );
    const perimeter = await trace.evaluate((e) => {
      e.parentElement.querySelectorAll("path").forEach((path) => {
        const animation = path.getAnimations()[0];
        if (!animation) throw Error("Focus perimeter must animate");
        animation.pause();
        animation.currentTime = 180;
      });
      return parseFloat(getComputedStyle(e).strokeDashoffset);
    });
    assert.ok(
      perimeter > 0.1 && perimeter < 1,
      "White border must be partially drawn mid-animation",
    );
    await page.screenshot({
      path: "artifacts/focus-loop-partial.png",
      fullPage: true,
    });
    await trace.evaluate((e) => {
      e.parentElement.querySelectorAll("path").forEach((path) => {
        path.getAnimations()[0].currentTime = 650;
      });
    });
    assert.equal(
      await trace.evaluate((e) =>
        parseFloat(getComputedStyle(e).strokeDashoffset),
      ),
      0,
    );
    const dimensions = await trace.evaluate((e) => ({
      width: e.getBBox().width,
      parent: e.closest(".focus-frame").getBoundingClientRect().width,
    }));
    assert.ok(
      Math.abs(dimensions.parent - dimensions.width - 1.5) < 1,
      "Perimeter fits the actual field width",
    );
    await page.screenshot({
      path: "artifacts/focus-loop-complete.png",
      fullPage: true,
    });
    assert.equal(
      await page
        .locator(".dashboard-create")
        .evaluate((e) => getComputedStyle(e).animationName),
      "motion-surface-in",
    );
    const slider = page.getByRole("slider", {
      name: "Agent coordination strictness",
    });
    await slider.fill("1");
    assert.equal(
      await slider.locator("..").evaluate((e) => getComputedStyle(e).boxShadow),
      "none",
      "Slider focus must not create a surrounding box",
    );
    await slider.press("ArrowRight");
    assert.equal(await slider.inputValue(), "2");
    await slider.press("End");
    assert.equal(await slider.inputValue(), "10");
    assert.equal(
      await slider.evaluate((e) => e.style.getPropertyValue("--range-fill")),
      "100%",
    );
    await slider.press("Home");
    assert.equal(await slider.inputValue(), "1");
    await slider.fill("7.4");
    assert.equal(await slider.getAttribute("aria-valuetext"), "7 out of 10");
    const b = await slider.boundingBox();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2);
    await page.mouse.down();
    assert.equal(
      await slider.locator("..").evaluate((e) => getComputedStyle(e).boxShadow),
      "none",
      "Slider drag must not create a surrounding box",
    );
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2, {
      steps: 15,
    });
    await page.mouse.up();
    assert.ok(
      Number(await slider.inputValue()) > 6,
      "Native drag remains functional",
    );

    await page.waitForTimeout(320);
    const start = button("Start session"),
      before = await start.boundingBox();
    await start.hover();
    await page.waitForTimeout(250);
    const after = await start.boundingBox();
    assert.deepEqual(after, before, "Hover must not move the click target");
    await page.mouse.down();
    await page.waitForTimeout(100);
    assert.equal(
      await start.evaluate((e) => getComputedStyle(e).translate),
      "0px 1px",
    );
    await page.mouse.move(10, 10);
    await page.mouse.up();
    await button("Completed").click();
    const tabs = page.getByRole("group", { name: "Session status" });
    // Native webviews define these tokens; an unthemed preview used to hide
    // the blue selection regression behind its neutral fallback.
    for (const accent of ["#04395e", "#0060c0", "#f38518"]) {
      await page.evaluate((accent) => {
        document.body.style.setProperty(
          "--vscode-list-activeSelectionBackground",
          accent,
        );
        document.body.style.setProperty(
          "--vscode-list-activeSelectionForeground",
          "#000000",
        );
      }, accent);
      for (const name of ["Active", "Completed"]) {
        await button(name).click();
        await page.waitForTimeout(350);
        assert.equal(
          await tabs.evaluate(
            (e) => getComputedStyle(e, "::before").backgroundColor,
          ),
          "rgb(48, 48, 52)",
        );
        assert.equal(
          await button(name).evaluate((e) => getComputedStyle(e).color),
          "rgb(255, 255, 255)",
        );
        assert.equal(await button(name).getAttribute("aria-pressed"), "true");
      }
    }
    await page.evaluate(() => {
      document.body.style.removeProperty(
        "--vscode-list-activeSelectionBackground",
      );
      document.body.style.removeProperty(
        "--vscode-list-activeSelectionForeground",
      );
    });
    await page.waitForTimeout(350);
    assert.equal(
      await button("Completed").getAttribute("aria-pressed"),
      "true",
    );
    assert.notEqual(
      await tabs.evaluate((e) => getComputedStyle(e, "::before").transform),
      "matrix(1, 0, 0, 1, 0, 0)",
    );

    await update("The task needs your attention.");
    const notice = page.getByRole("alert");
    await notice.waitFor();
    assert.equal(
      await notice.evaluate((e) => getComputedStyle(e).animationName),
      "motion-notice-in",
    );
    await page.waitForTimeout(320);
    await update("The task needs your attention.");
    assert.equal(
      await notice.evaluate((e) => e.getAnimations().length),
      0,
      "Unchanged state must not replay the entrance",
    );
    // Observe the immediate inert exit before the 160ms removal fallback.
    const exiting = await page.evaluate(async (state) => {
      window.postMessage({ type: "state", state }, location.origin);
      return await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const e = document.querySelector(".motion-notice[data-exiting]");
          if (e) {
            observer.disconnect();
            resolve({
              inert: e.inert,
              hidden: e.getAttribute("aria-hidden"),
              animation: getComputedStyle(e).animationName,
            });
          }
        });
        observer.observe(document.body, { subtree: true, attributes: true });
      });
    }, state);
    assert.deepEqual(exiting, {
      inert: true,
      hidden: "true",
      animation: "motion-notice-out",
    });
    await update("A replacement notification stays visible.");
    await page.waitForTimeout(220);
    assert.match(await notice.innerText(), /replacement notification/);
    await update(undefined);
    await page.locator(".motion-notice").waitFor({ state: "detached" });

    for (const source of ["os", "vscode"]) {
      if (source === "os") await page.emulateMedia({ reducedMotion: "reduce" });
      else {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.evaluate(() =>
          document.body.classList.add("vscode-reduce-motion"),
        );
      }
      await update(`Reduced motion: ${source}`);
      await notice.waitFor();
      assert.equal(
        await notice.evaluate((e) => getComputedStyle(e).animationName),
        "none",
      );
      assert.equal(
        await tabs.evaluate(
          (e) => getComputedStyle(e, "::before").transitionDuration,
        ),
        "0s",
      );
      await nameField.focus();
      assert.equal(
        await trace.evaluate((e) => getComputedStyle(e).animationName),
        "none",
      );
      assert.equal(
        await trace.evaluate((e) =>
          parseFloat(getComputedStyle(e).strokeDashoffset),
        ),
        0,
      );
      await update(undefined);
      await page.locator(".motion-notice").waitFor({ state: "detached" });
    }
    await page.evaluate(() =>
      document.body.classList.remove("vscode-reduce-motion"),
    );
    await update(undefined, "sidebar");
    await page.setViewportSize({ width: 375, height: 850 });
    const connect = button("Connect a provider");
    await connect.hover();
    await page.waitForTimeout(650);
    const linkStyle = await connect.evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        shadow: s.boxShadow,
        background: s.backgroundColor,
        underline: s.backgroundSize,
      };
    });
    assert.equal(linkStyle.shadow, "none");
    assert.equal(linkStyle.background, "rgba(0, 0, 0, 0)");
    assert.equal(linkStyle.underline, "100% 1px");
    await page.screenshot({
      path: "artifacts/provider-hover-refined.png",
      fullPage: true,
    });
    await button("Start a session").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((e) => getComputedStyle(e).animationName),
      "motion-dialog-in",
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await button("Start a session").evaluate(
        (e) => e === document.activeElement,
      ),
      true,
      "Modal restores focus",
    );
    await update(undefined);
    await button("New session").click();
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await slider.fill("7");
    await page.waitForTimeout(350);
    await page.screenshot({
      path: "artifacts/motion-dashboard.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "native slider drag and keyboard",
          "white focus border draws a partial then complete perimeter",
          "text-link hover has no rectangular background or shadow",
          "stable hover and press feedback",
          "sliding tab selection",
          "notification entrance and inert exit",
          "replacement notification during exit",
          "no repeated entrance on state updates",
          "OS and VS Code reduced motion",
          "dialog focus restore",
          "responsive layout",
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
