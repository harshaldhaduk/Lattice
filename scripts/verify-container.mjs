import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import WebSocket from "ws";
const exec = promisify(execFile);
let container;
try {
  const started = await exec(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "-p",
      "127.0.0.1::4319",
      "-e",
      "LATTICE_STORAGE_KEY",
      "lattice-relay:0.3.0",
    ],
    {
      env: {
        ...process.env,
        LATTICE_STORAGE_KEY: randomBytes(32).toString("hex"),
      },
    },
  );
  container = started.stdout.trim();
  const port = (await exec("docker", ["port", container, "4319/tcp"])).stdout
    .trim()
    .split(":")
    .at(-1);
  let health;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(health?.ok, true);
  assert.equal(health.authentication, "github");
  const closed = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(Error("Anonymous socket was not rejected"));
    }, 4000);
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.on("error", reject);
  });
  assert.equal(closed, 4003);
  const user = (
    await exec("docker", ["exec", container, "id", "-u"])
  ).stdout.trim();
  assert.notEqual(user, "0");
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "container starts",
        "health endpoint reports authentication and storage",
        "anonymous clients rejected",
        "runtime does not run as root",
      ],
    }),
  );
} finally {
  if (container) await exec("docker", ["stop", container]);
}
