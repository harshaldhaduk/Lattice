import { startRelay } from "./server";
async function main() {
  const port = Number(process.env.PORT || 4319);
  const host = process.env.HOST || "127.0.0.1";
  const hosted = host === "0.0.0.0" && process.env.LATTICE_AUTH === "github";
  if (
    hosted &&
    (!process.env.LATTICE_STORAGE_KEY || !process.env.LATTICE_DATA_DIR)
  )
    throw Error("Hosted mode requires LATTICE_STORAGE_KEY and LATTICE_DATA_DIR.");
  const relay = await startRelay({
    port,
    host,
    dataDir: process.env.LATTICE_DATA_DIR,
    storageKey: process.env.LATTICE_STORAGE_KEY,
    requireIdentity: process.env.LATTICE_AUTH === "github",
    organization: process.env.LATTICE_GITHUB_ORG,
  });
  console.log(
    `Lattice Sync relay listening on ${host}:${relay.port}. Use HOST=0.0.0.0 for a LAN/tailnet; terminate TLS at a proxy for internet access.`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      relay.close().then(() => process.exit(0));
    });
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
