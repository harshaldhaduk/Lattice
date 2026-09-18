import { build, context } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
const common = {
  bundle: true,
  sourcemap: true,
  minify: true,
  logLevel: "info",
};
const configs = [
  {
    ...common,
    entryPoints: ["src/webview/preview.ts"],
    outfile: "dist/preview.js",
    platform: "browser",
    format: "iife",
  },
  {
    ...common,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.cjs",
    platform: "node",
    format: "cjs",
    target: "node20",
    define: { navigator: "undefined" },
    external: ["vscode", "@anthropic-ai/claude-agent-sdk"],
  },
  {
    ...common,
    entryPoints: ["src/webview/index.tsx"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
  },
  {
    ...common,
    entryPoints: ["src/relay/cli.ts"],
    outfile: "dist/relay.cjs",
    platform: "node",
    format: "cjs",
    target: "node20",
  },
];
await copyFile(
  "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
  "dist/claude-sdk.mjs",
);
await copyFile(
  "node_modules/@anthropic-ai/claude-agent-sdk/LICENSE.md",
  "dist/claude-sdk-LICENSE.md",
);
if (process.argv.includes("--watch")) {
  for (const config of configs) {
    const ctx = await context(config);
    await ctx.watch();
  }
} else await Promise.all(configs.map((c) => build(c)));
