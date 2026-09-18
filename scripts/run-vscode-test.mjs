import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
const source = process.argv[2] || "test/vscode-workspace.ts";
const output = resolve("dist", basename(source, ".ts") + "-test.cjs");
await build({
  entryPoints: [source],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  define: { navigator: "undefined" },
});
const profile = await mkdtemp(join(tmpdir(), "lattice-test-profile-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.env.VSCODE_EXECUTABLE ||
    "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  [
    `--user-data-dir=${profile}`,
    `--extensions-dir=${join(profile, "extensions")}`,
    `--extensionDevelopmentPath=${resolve(".")}`,
    `--extensionTestsPath=${output}`,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    resolve("."),
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
child.stdout.on("data", (data) => {
  log += data;
  if (String(data).includes("_OK")) process.stdout.write(data);
});
child.stderr.on("data", (data) => (log += data));
const timer = setTimeout(() => {
  console.error("Native test timed out\n" + log.slice(-8000));
  child.kill();
  process.exitCode = 1;
}, 90000);
child.on("exit", (code) => {
  clearTimeout(timer);
  if (code) console.error(log.slice(-10000));
  process.exitCode = code || process.exitCode || 0;
});
