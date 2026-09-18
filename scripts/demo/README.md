# Two-user video demo

Records a narrated, split-screen walkthrough using the extension's React sidebar,
composer, and live editor, rendered inside a browser presentation frame.

Session creation, invitations, membership, presence, document transport, CRDT
updates, and shared activity use two real clients and a local session relay.
Agent responses, code-writing events, and provider usage are scripted fixtures.
The video labels this distinction throughout. This is not a recording of two
native VS Code windows or a live Codex/Claude inference run.

## Reproduce

From the repository root, with dependencies installed:

```sh
npx tsx scripts/demo/record.ts
node scripts/demo/export.mjs
```

Requires Google Chrome at its standard macOS application path, `ffmpeg` and
`ffprobe` on PATH, and the macOS `say` command with the Samantha voice.

## Outputs

- `artifacts/lattice-two-user-demo.mp4`: H.264/AAC video with narration and chapters.
- `artifacts/lattice-two-user-demo.srt`: narration subtitles.
- `artifacts/lattice-two-user-demo-poster.jpg`: live-edit poster frame.
- `artifacts/demo/manifest.json`: timing, capture errors, and simulation disclosure.
- `artifacts/demo/two-users-source.webm`: source screen recording.

The walkthrough covers invitations, teammate presence, separate Codex and Claude
prompts, live source edits with a moving avatar, conversation viewing and guidance,
and per-person usage. No external account or paid inference is used.
