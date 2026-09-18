import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const domain = process.argv[2];
const organization = process.argv[3] || "";
if (
  !domain ||
  !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(domain) ||
  (organization && !/^[a-z\d-]{1,39}$/i.test(organization))
) {
  console.error(
    "Usage: node scripts/configure-host.mjs relay.your-domain.com [github-organization]",
  );
  process.exitCode = 1;
} else {
  const file = new URL("../deploy/.env", import.meta.url);
  await writeFile(
    file,
    `LATTICE_DOMAIN=${domain}\nLATTICE_STORAGE_KEY=${randomBytes(32).toString("hex")}\nLATTICE_GITHUB_ORG=${organization}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Created deploy/.env. Back up this file securely; its key is required to restore your sessions.",
  );
}
