import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

// Render the code-owned SVG at listing size; no generated bitmap source required.
const svg = await readFile(resolve("media/mark.svg"), "utf8");
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;width:512px;height:512px;background:transparent}body{display:grid;place-items:center;background:#181b1d;border-radius:92px;color:#f0f1ee}svg{width:324px;height:365px}</style>${svg}`,
  );
  await page.screenshot({
    path: resolve("media/icon.png"),
    omitBackground: true,
  });
} finally {
  await browser.close();
}
