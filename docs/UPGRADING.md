# Upgrading to Lattice Sync 0.5.2

0.5.2 renames the extension to **Lattice Sync**, sets its Marketplace identity to `HarshalDhaduk.lattice-sync`, and updates session invitations. It retains the branch sessions, dashboard, role-based steering, limit handoffs and checked reconciliation introduced in 0.5.0. The relay protocol remains version 3; the 0.5.0 relay bundle is compatible.

VS Code treats the earlier `local-workbench.lattice` and `HarshalDhaduk.lattice` test builds and this extension identity as separate extensions. Disable or uninstall the earlier extension, install `lattice-sync-0.5.2.vsix`, and reload the window so only one copy runs. Existing `lattice.*` settings and command IDs are unchanged. Extension-owned saved-session credentials, webview drafts and state do not automatically transfer between identities. Create or rejoin a session with a newly generated invitation, and sign in again if using a hosted relay. Retain any previous extension storage backup until needed history has been recovered. Provider CLI logins are managed separately and remain available.

Existing sessions without branch metadata retain their legacy live-workspace behavior; create a new feature session to use the branch/PR lifecycle.

For a self-hosted relay, stop the old process, retain the data directory and encryption key, rename environment variables to `LATTICE_*` as shown in [Deployment](DEPLOYMENT.md), and start the new build. Do not generate a replacement encryption key for existing data. Encrypted snapshots with an earlier authenticated product tag remain readable; the next successful write uses the current tag and preserves the previous snapshot in the backup file. Plain JSON snapshots also remain readable. Invite links now target the new extension identifier; hosts should copy fresh links.

Private dot-directories are excluded from workspace sharing, including storage left by earlier versions. This also excludes hidden configuration directories; share their contents separately only after review. The project directory name on disk has no effect on extension identity.
