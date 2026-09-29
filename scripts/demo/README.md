# Video demos

## Animation showcase — 0.5.11

```sh
LATTICE_RECORDLY=1 LATTICE_FINAL_DEMO=1 RECORDLY_OUTPUT_DIR=artifacts/demo-animations-v0511 node scripts/demo/motion-record.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-animations-v0511 node scripts/demo/verify-native-motion.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-animations-v0511 node scripts/demo/final-compose.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-animations-v0511 node scripts/demo/track-recorded-caret.mjs
LATTICE_OVERLAP=1 RECORDLY_OUTPUT_DIR=artifacts/demo-animations-v0511 RECORDLY_DESTINATION=artifacts/lattice-animations-demo-silent.mp4 node scripts/demo/final-export.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-animations-v0511 RECORDLY_AUDIO_DESTINATION=artifacts/lattice-animations-demo.mp4 node scripts/demo/recorded-demo-sounds.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-animations-v0511 node scripts/demo/verify-final.mjs
```

Fresh native-window video captures the current build at 60 fps. Application
footage is not assembled from screenshots; PNGs are only static background,
window-control artwork, and review proofs. Setup, joining, and the dedicated
session-hover shot play at normal speed to preserve focus outlines, slider
feedback, card glow/fade, and button reactions. The usage-limit and takeover
notifications each have a two-second reading hold. The dark orange/blue
background, overlapping active windows, click zooms, caret-following camera,
white motion captions, interaction sounds, and final fade remain.

The fixture VSIX takes its version and description from the current package.
Agent inference, quota failure, and GitHub PR #184 remain fixtures; no paid
provider request or external PR is made. Superseded demo exports and capture
directories were moved to Trash during cleanup; the current source footage,
edit assets, and both final exports are retained.

The published 0.5.11 JavaScript/CSS were compared byte-for-byte with the capture
build before recording. Native VS Code tests verify neutral Active/Completed
selection in dark, light, and high-contrast themes. Source-video frame checks
verify the focus entrance, slider drag, and card hover/fade are moving footage
before any camera effects are applied.

The audio version uses real Magic Mouse and iMac keyboard recordings, with
source/license notes in `artifacts/demo-sounds/SOURCES.md`. Clicks follow the
recorded events; natural typing bursts accompany human prompt entry only.
There are no synthesized tones or added typing over AI output or reading holds.
The earlier synthetic mix is not used. The silent master remains a separate file.

The compositor extends each native capture's last unchanged frame through the
closing hold, because ScreenCaptureKit can stop emitting frames on a static
window. The exporter checks source duration before starting. The 0.5.11 export
uses `RECORDLY_SOURCE=artifacts/demo-animations-v0511/source-complete.mp4` for
the already-composed capture with this closing hold restored.

## Historical workflows (superseded exports removed)

The workflows below document earlier iterations, not the current deliverable.

### Active-window edit with interaction sounds

```sh
LATTICE_RECORDLY=1 LATTICE_FINAL_DEMO=1 RECORDLY_OUTPUT_DIR=artifacts/demo-overlap-audio node scripts/demo/motion-record.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-overlap-audio node scripts/demo/final-compose.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-overlap-audio node scripts/demo/track-recorded-caret.mjs
LATTICE_OVERLAP=1 RECORDLY_OUTPUT_DIR=artifacts/demo-overlap-audio RECORDLY_DESTINATION=artifacts/lattice-overlap-demo-silent.mp4 node scripts/demo/final-export.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-overlap-audio node scripts/demo/add-demo-sounds.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-overlap-audio node scripts/demo/verify-final.mjs
```

`artifacts/lattice-overlap-demo.mp4` adds original synthesized click and keyboard
foley, aligned to recorded events through the speed regions. No music or voice.
The active window expands to 1740/2560 pixels (68%), moves in front of the other
window, then receives the Recordly close-up. Observation shots restore equal
windows. Each window has its own 24px rounded clipping mask and shadow.
Maya's dashboard/create sequence asserts that VS Code's bottom panel is closed.
The earlier export held Maya's quota message and Noah's continuation notification
for more than seven seconds; the current recorder uses two seconds each. Agent typing foley
is suppressed during this reading interval.
`window-layout.mjs` is shared by the compositor and pointer/camera coordinate
mapping, so the cursor remains aligned while windows move. Dynamic compositing,
typography, caret tracking, and sound require the scripts; `.recordly` alone
contains the underlying source and base edit, not the complete finished scene.

## Final product demo (historical)

```sh
npm run build
LATTICE_RECORDLY=1 LATTICE_FINAL_DEMO=1 RECORDLY_OUTPUT_DIR=artifacts/demo-final-v2 node scripts/demo/motion-record.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-final-v2 node scripts/demo/final-compose.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-final-v2 node scripts/demo/track-recorded-caret.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-final-v2 node scripts/demo/final-export.mjs
RECORDLY_OUTPUT_DIR=artifacts/demo-final-v2 node scripts/demo/verify-final.mjs
```

Outputs `artifacts/lattice-final-demo.mp4`, silent 2560 × 1440 at 60 fps.
This is a new native recording planned for the edit, not a reuse of the previous
video. It demonstrates Maya prompting, Noah explicitly following and steering,
Maya approving guidance, her next request hitting a controlled quota error,
Noah accepting and continuing the task, Noah sending his own follow-up, and the
owner returning to Completed to find the branch with its PR.

The dark orange/blue background comes from Recordly's sequoia-blue-orange
wallpaper. Native title bars are captured; the macOS capture-sharing indicator
is replaced by decorative standard window-control dots in the composition.
The actual application content is not recreated. Each recorded click generates
a camera target. A dedicated shot uses measured live-agent caret positions for
horizontal and vertical camera movement. Recordly renders the camera and mouse;
`final-export.mjs` adds white animated typography and the final fade to black on
its output canvas before encoding each frame. Caption placement and tracking
data are saved in `motion-design.json`. The `.recordly` project contains the
base edit; the custom typography and dynamic caret track require the finishing
script to reproduce exactly.

Only demo profiles, sample repos, and the local relay are used. Agent inference,
the provider quota failure, and GitHub PR #184 are fixtures. Native VS Code,
extension installation, source edits, shared workspace, owner approval,
handoff/continuation, local Git operations, and tests are real. No paid provider
quota is consumed and no external GitHub PR is created.

## Earlier Recordly motion demo

The earlier artifact is retained below for comparison. The current recorder
follows the revised storyboard above; use those commands for new recordings.

Outputs `artifacts/lattice-recordly-demo.mp4`: silent 2560 × 1440 at 60 fps.
Two native VS Code windows are captured independently with Recordly's macOS
ScreenCaptureKit helper. The capture excludes the desktop and other apps.
Recordly's actual PixiJS frame renderer and MP4 exporter apply the zoom regions,
spring-smoothed macOS pointer, click bounce, and motion blur. The background and
top/bottom margins remain black. Both people send prompts: the sender's live
view opens automatically, then the teammate explicitly follows that agent.

Source recordings, cursor telemetry, chapters, export metrics, and an editable
`lattice.recordly` project live in `artifacts/demo-recordly/`. The 16:7 project
is rendered with 160-pixel black bands added for the final 16:9 delivery.

The renderer uses the external AGPL-3.0 project
[Recordly](https://github.com/webadderallorg/Recordly), checkout
`18884285b11b3603fc4ccede89add40e0e4a9bd6`, installed at
`/tmp/lattice-recordly-motion` (override `RECORDLY_ROOT` for export).
Its capture helper is locally adapted to use `desktopIndependentWindow` and
keep the main dispatch loop available for ScreenCaptureKit callbacks. The
compiled helpers are `/tmp/lattice-recordly-capture-v2` and
`/tmp/lattice-recordly-window-list`. Hardware composition/letterboxing uses
`/opt/homebrew/bin/ffmpeg` with VideoToolbox. No paid inference or external PR
is used: agent inference and GitHub are fixtures; files, relay, synchronization,
provider adapters, and native VS Code UI are real.

## Earlier screenshot-loop motion demo

Retained earlier artifact (not the current recording workflow).

Outputs `artifacts/lattice-two-laptops-demo.mp4`: silent 2560 × 1440, with
two continuously captured native VS Code windows side by side, plain black
top/bottom bands, and an animated pointer synchronized with real clicks.
The walkthrough includes the strictness slider, VSIX installation, workspace
teleport, progressively written code, moving remote cursors, following edits,
teammate guidance, and the PR review state.

The profiles, Git repositories, and local relay are disposable fixtures. The
provider in `motion-agent.cjs` scripts inference but writes real files through
the actual provider adapter; synchronization and cursor rendering use Lattice.
The GitHub CLI is a fixture: no external PR is created. Source video, chapter
frames, and a manifest with observed cursor-position counts are saved under
`artifacts/demo-motion/`. Requires native VS Code, Chrome, ffmpeg, and ffprobe.

## Native VS Code walkthrough

`native-record.mjs` records the silent install/create/join/PR walkthrough in two
isolated, disposable VS Code profiles. It builds a small `relayboard-demo`
fixture, installs a freshly packaged VSIX for the guest, runs a real local
Lattice session, switches both windows into managed session workspaces, and
uses a local GitHub CLI fixture for the final PR state.

```sh
npm run build
node scripts/demo/native-record.mjs
```

The output is `artifacts/lattice-native-vscode-demo.mp4`: 2560 × 1440 at 25
fps, with a 2560 × 1120 native VS Code capture centered between plain black
bands. It contains no audio stream. Timing and fixture disclosure are recorded
in `artifacts/demo-native/manifest.json`.

## Browser presentation walkthrough

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
