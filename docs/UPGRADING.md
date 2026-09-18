# Upgrading to Lattice 0.5.0

0.5.0 adds branch sessions, the left-side dashboard, consent-based steering, limit handoffs and checked reconciliation. Update both extensions and the relay. Existing Lattice settings and memberships remain under the same extension ID. Existing sessions without branch metadata retain their legacy live-workspace behavior; create a new feature session to use the branch/PR lifecycle.

The earlier 0.4.1 release completed the product identity change. The extension identifier is `local-workbench.lattice`, settings and commands start with `lattice.`, and relay environment variables start with `LATTICE_`.

VS Code treats a changed extension identifier as a separate extension. Install `lattice-0.5.0.vsix`, remove the previous extension, and reload the window. Existing settings, keyboard shortcuts, webview drafts, saved-session credentials and panel placement under the previous identifier do not automatically transfer. Re-enter custom settings under `lattice.*`, sign in if using a hosted relay, and create or rejoin a session with a newly generated invitation. Keep the previous extension's storage backup until any needed history has been recovered. Provider CLI logins are managed separately and remain available.

For a self-hosted relay, stop the old process, retain the data directory and encryption key, rename environment variables to `LATTICE_*` as shown in [Deployment](DEPLOYMENT.md), and start the new build. Do not generate a replacement encryption key for existing data. Encrypted snapshots with an earlier authenticated product tag remain readable; the next successful write uses the current tag and preserves the previous snapshot in the backup file. Plain JSON snapshots also remain readable. Invite links now target the new extension identifier; hosts should copy fresh links.

Private dot-directories are excluded from workspace sharing, including storage left by earlier versions. This also excludes hidden configuration directories; share their contents separately only after review. The project directory name on disk has no effect on extension identity.
