# Test Lattice 0.5.0

Download `lattice-0.5.0.vsix` from this release. In each VS Code installation, open Extensions, select the `...` menu, choose **Install from VSIX**, select the file, and reload the window. Requires VS Code 1.106 or newer.

For a second VS Code window on the same computer, the extension is already installed in the same profile. With a separate profile, install the VSIX there too. Start a session in the Lattice activity-bar dashboard, copy the invite, and join from the other profile/window. Use distinct participant names.

For different computers, install the VSIX on each computer and use the matching `lattice-relay-0.5.0.zip` relay bundle. Its README explains the one-command launcher and two settings needed on both computers. Downloading the extension does not provision a hosted relay.

The project used for testing must be a Git repository with an accessible GitHub origin and a main branch (or configure `lattice.baseBranch`). The session creates a new feature worktree, so uncommitted files in the original checkout are not included in the new branch. Dependencies and provider logins are local to each participant. A signed-in GitHub CLI (`gh`) and configured project checks are required to publish a PR from Lattice.

Suggested checks:

1. Create a session, invite a teammate, and verify their live file location and source edits.
2. Run one prompt each. Click the teammate's prompt to send guidance. An editor needs the agent owner's approval; the session owner can guide directly.
3. Add a file-pinned note, change that file, and verify the stale marker and review action.
4. Use Finish -> Create PR to review and publish. Review/merge on GitHub and check the dashboard's completion status.

40 automated tests, browser checks and native macOS VS Code integration tests passed for this build. Real paid-provider execution, Windows OS execution and a two-machine deployment remain field tests. No guarantee of zero semantic conflicts is made: unresolved or failing reconciliation retains recovery checkpoints for review.

The release source branch `releases/vscode-0.5.0` contains this VS Code implementation. Use this release's source/tag if rebuilding; the repository's existing main branch has an older layout.
