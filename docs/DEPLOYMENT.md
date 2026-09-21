# Hosted relay

The checked-in deployment runs a single relay behind Caddy, with GitHub sign-in and encrypted persistent storage. It is ready to deploy to a Linux host with Docker Compose. A public deployment still requires your host, DNS domain, and optional GitHub organization; none has been selected or provisioned in this workspace.

## Configure and launch

Point a domain’s DNS record to the chosen host and allow inbound TCP 80/443 and optional UDP 443. On that host, from this project:

```sh
node scripts/configure-host.mjs collaborate.your-domain.com your-github-org
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

Omit the organization argument to permit any verified GitHub account that also has a valid session invitation. The setup script creates `deploy/.env` with restrictive permissions and a random encryption key. It refuses to overwrite an existing configuration. Keep an encrypted copy of this configuration in your own secret manager: losing its key makes session backups unreadable.

Caddy provisions and renews TLS certificates for the configured domain. Its reverse proxy supports WebSockets. See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) and [WebSocket proxying](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Set VS Code’s `lattice.relayUrl` to `wss://collaborate.your-domain.com`. Run **Lattice: Sign In to Relay**, then create/join a session. VS Code obtains the GitHub token; the relay validates it with GitHub’s [authenticated-user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user) and, when configured, verifies active organization membership. The token is never written to session snapshots.

## Operations

- `GET /health` returns service, storage and authentication status. Failed writes make this endpoint return 503.
- Container logs report startup and persistence failures. Transcripts and provider credentials are not emitted to these logs.
- The relay runs as a non-root user, with a read-only root filesystem, writable data volume, dropped capabilities, and bounded memory/processes.
- Every connection revalidates identity. Session role changes and removals apply immediately; organization membership is rechecked when connecting.
- Owners manage roles, revoke invitations, archive/reopen sessions, set usage budgets and export session data in the extension.
- One relay process owns the volume. Do not point multiple active relay processes at the same files. This deployment is not a clustered service.
- Snapshots are debounced by 100 ms and written atomically. Abrupt power loss can lose the last pending interval; graceful shutdown flushes it.

## Backups and recovery

Stop the relay before taking a consistent volume backup:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml stop relay
docker compose --env-file deploy/.env -f deploy/compose.yaml cp relay:/data ./relay-backup
docker compose --env-file deploy/.env -f deploy/compose.yaml start relay
```

The volume contains `sessions.json` and the previous `sessions.json.backup`, both authenticated ciphertext in hosted mode. Store backups outside the server and keep the encryption key separately. Session exports from the UI are intentionally readable JSON and should be handled as project data.

To recover on a replacement host, use the same configuration/key, create the stopped relay container, restore these files into its `/data` volume with owner UID 1000, and start it. Existing member resume tokens continue to work if clients use the recovered relay URL. If the newest snapshot is corrupt, preserve it for investigation and restore the known-good backup as `sessions.json` while the relay is stopped. A wrong key or tampered snapshot prevents startup; the application does not silently reset the store.

Existing local unencrypted snapshots are not automatically converted. Keep the local store intact and start hosted mode with a new data volume. An explicit migration tool would be needed to preserve old local memberships while changing the storage format.

## Updates and validation

`docker compose ... up -d --build` rebuilds the relay. Disconnected agents are marked stopped after a restart and pending approvals are denied. Participants reconnect using their existing memberships; they restart tasks deliberately from the retained worktrees.

The extension is packaged as `lattice-sync-0.5.4.vsix` under publisher `HarshalDhaduk`. Install it on every participant’s machine and reload VS Code. See [upgrade notes](UPGRADING.md) when replacing the earlier test build. Marketplace distribution requires uploading this package in the publisher management page or publishing with authenticated `vsce`; building the package alone does not publish it.

Locally verified: container build/startup/health, anonymous rejection, non-root execution, storage round trips and key rejection, membership authorization, 24 concurrent local clients, and native Mac editor flows. Public DNS/TLS issuance, real GitHub sign-in against your organization, cross-machine networking and paid model execution still require a deployment trial.
