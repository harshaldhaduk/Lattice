import * as vscode from "vscode";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { SessionClient } from "../shared/client";
import type { Controller } from "./controller";
import type { Credentials, BranchSession } from "../shared/protocol";
import { git } from "./git";
import {
  createBranchSession,
  discoverChecks,
  reconcileBranch,
  github,
  pullRequest,
  publishPullRequest,
  runChecks,
  snapshot,
  type Recovery,
} from "./branch-workflow";
export class SessionFlow {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private refreshing = false;
  private failedBase?: string;
  private observedAt = 0;
  private observing = false;
  private creating = false;
  private disposed = false;
  constructor(private c: Controller) {}
  start() {
    this.timer = setInterval(() => void this.tick(), 15000);
    void this.tick();
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const previous = this.c.context.globalState.get<any[]>("sessions", []);
      if (
        this.c.client.connected &&
        this.c.client.capabilities.includes("brain")
      ) {
        const memberships = [];
        for (const s of previous) {
          const raw = await this.c.context.secrets.get(`savedSession:${s.id}`);
          if (raw) {
            const c: Credentials = JSON.parse(raw);
            if (c.relay === this.c.client.credentials?.relay)
              memberships.push({ room: c.room, resume: c.resume });
          }
        }
        const sessions = await this.c.client.request({
          op: "brain.context",
          memberships,
        });
        this.c.client.brain = sessions.map((s: any) => ({
          ...s,
          memories: s.memories?.filter((n: any) => !n.stale),
        }));
        this.c.client.emit("brain");
        const cached = this.c.context.globalState.get<any[]>("dashboard", []);
        this.c.state.dashboard = [
          ...sessions,
          ...cached.filter((c) => !sessions.some((s: any) => s.id === c.id)),
        ];
        await this.c.context.globalState.update(
          "dashboard",
          this.c.state.dashboard,
        );
      } else
        this.c.state.dashboard = this.c.context.globalState.get(
          "dashboard",
          [],
        );
      this.c.emitState();
    } finally {
      this.refreshing = false;
    }
  }
  private async observeSaved() {
    if (this.observing || this.disposed || Date.now() - this.observedAt < 60000)
      return;
    this.observing = true;
    try {
      this.observedAt = Date.now();
      const saved = this.c.context.globalState
        .get<{ id: string }[]>("sessions", [])
        .slice(0, 50);
      const cards = [...(this.c.state.dashboard || [])];
      // Separate read connections never take a live teammate's place in a session.
      for (const item of saved) {
        if (this.disposed) return;
        const raw = await this.c.context.secrets.get(`savedSession:${item.id}`);
        if (!raw) continue;
        const credentials: Credentials = JSON.parse(raw);
        const observer = new SessionClient();
        observer.authorization = this.c.client.authorization;
        try {
          await observer.connect(credentials.relay);
          const proof = {
            op: "session.observe",
            room: credentials.room,
            resume: credentials.resume,
          };
          let observed = await observer.request(proof);
          const life = observed.card.lifecycle;
          const path = this.c.context.globalState.get<string>(
            "managedWorkspace:" + item.id,
          );
          if (
            observed.owner &&
            path &&
            life?.pullRequest &&
            !observed.card.archived
          ) {
            const pr = await pullRequest(
              path,
              observed.card.branch,
              life.pullRequest.number,
            );
            if (pr && ["MERGED", "CLOSED"].includes(pr.state))
              observed = await observer.request({
                ...proof,
                completion: {
                  number: pr.number,
                  status: pr.state === "MERGED" ? "merged" : "closed",
                },
              });
          }
          const i = cards.findIndex((c) => c.id === item.id);
          if (i < 0) cards.push(observed.card);
          else cards[i] = observed.card;
        } catch {
          /* Keep the last known card when a relay or GitHub is offline. */
        } finally {
          await observer.disconnect();
        }
      }
      this.c.state.dashboard = cards;
      await this.c.context.globalState.update("dashboard", cards);
      this.c.emitState();
    } finally {
      this.observing = false;
    }
  }
  async create(title: string) {
    if (this.creating)
      throw Error("Your new session is already being prepared.");
    this.creating = true;
    try {
      if (!vscode.workspace.isTrusted)
        throw Error("Trust this repository before creating a session.");
      const prepared = await createBranchSession(
        this.c.root,
        join(this.c.context.globalStorageUri.fsPath, "sessions"),
        title,
        vscode.workspace.getConfiguration("lattice").get("baseBranch", "main"),
      );
      await this.c.host(title, prepared.path, prepared.lifecycle);
      const credentials = this.c.client.credentials!;
      await this.c.context.secrets.store(
        "session:" + vscode.Uri.file(prepared.path).toString(),
        JSON.stringify(credentials),
      );
      await this.c.context.globalState.update(
        "managedWorkspace:" + credentials.room,
        prepared.path,
      );
      await this.refresh();
      this.c.sessionWorkspace.dispose();
      await this.c.client.disconnect();
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(prepared.path),
        { forceNewWindow: true },
      );
    } finally {
      this.creating = false;
    }
  }
  async open(id: string) {
    const path = this.c.context.globalState.get<string>(
      "managedWorkspace:" + id,
    );
    if (path && existsSync(path)) {
      const credentials = await this.c.context.secrets.get(
        `savedSession:${id}`,
      );
      if (!credentials)
        throw Error(
          "Session membership is missing. Join with a new invitation.",
        );
      await this.c.context.secrets.store(
        "session:" + vscode.Uri.file(path).toString(),
        credentials,
      );
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(path),
        { forceNewWindow: true },
      );
    } else await this.c.resumeSession(id);
  }
  private async update(lifecycle: BranchSession) {
    await this.c.client.event({ type: "session.lifecycle", lifecycle });
  }
  private async checks() {
    return discoverChecks(
      this.c.root,
      vscode.workspace
        .getConfiguration("lattice")
        .get<string[]>("taskCheckCommand", []),
    );
  }
  private idle() {
    return (
      !(this.c.state.session?.tasks || []).some((t) =>
        ["running", "approval"].includes(t.status),
      ) &&
      !["running", "approval"].includes(this.c.state.run?.status || "") &&
      !vscode.workspace.textDocuments.some(
        (d) =>
          d.uri.scheme === "file" &&
          d.isDirty &&
          d.uri.fsPath.startsWith(this.c.root + "/"),
      )
    );
  }
  private async reconcile(force = false) {
    const s = this.c.client.session,
      life = s?.lifecycle;
    if (!s || !life || ["merged", "closed"].includes(life.status)) return;
    if ((await git(this.c.root, ["branch", "--show-current"])) !== s.branch)
      throw Error("Return to this session's branch before continuing.");
    await git(this.c.root, ["fetch", "origin", life.baseBranch]);
    const target = await git(this.c.root, ["rev-parse", "FETCH_HEAD^{commit}"]);
    if (target === life.baseCommit || (!force && this.failedBase === target))
      return;
    if (!this.idle()) {
      this.c.state.brainStatus =
        "Base branch changed · waiting for a safe checkpoint";
      this.c.emitState();
      return;
    }
    await this.update({
      ...life,
      status: "reconciling",
      detail: "Checking this session against the latest base…",
    });
    const revision = this.c.client.session?.workspace?.revision;
    this.c.sessionWorkspace.dispose();
    try {
      const result = await reconcileBranch({
        root: this.c.root,
        storage: join(this.c.context.globalStorageUri.fsPath, "reconciliation"),
        branch: s.branch,
        base: life.baseCommit,
        target,
        recovery: this.c.context.workspaceState.get<Recovery>("reconciliation"),
        checks: await this.checks(),
        stillSafe: () =>
          this.idle() &&
          this.c.client.connected &&
          this.c.client.session?.workspace?.revision === revision,
        resolve: (path, files) => this.c.resolveConflicts(path, files),
      });
      await this.update({
        ...life,
        baseCommit: result.base,
        status: life.pullRequest ? "review" : "active",
        detail: "Updated from the base branch · checks passed",
      });
      await this.c.context.workspaceState.update("reconciliation", undefined);
      this.failedBase = undefined;
      this.c.state.brainStatus = "Updated from the base branch · checks passed";
    } catch (e: any) {
      this.failedBase = target;
      if (e.recovery)
        await this.c.context.workspaceState.update(
          "reconciliation",
          e.recovery,
        );
      await this.update({
        ...life,
        status: "attention",
        detail: String(e.message).slice(0, 1000),
      });
      this.c.state.brainStatus =
        "An update needs your attention. Your work is preserved.";
    } finally {
      await this.c.sessionWorkspace.start(this.c.root, true);
      this.c.emitState();
    }
  }
  async tick() {
    if (this.busy || this.creating || this.disposed) return;
    this.busy = true;
    try {
      await this.refresh();
      void this.observeSaved().catch(() => {});
      const s = this.c.client.session;
      if (
        !this.c.client.connected ||
        !s?.lifecycle ||
        this.c.sessionWorkspace.loading ||
        s.people.find((p) => p.id === this.c.state.me)?.role !== "owner"
      )
        return;
      if (s.lifecycle.status === "reconciling") {
        await this.update({
          ...s.lifecycle,
          status: "attention",
          detail:
            "An update was interrupted. Review the session, then choose Review update to resume.",
        });
        return;
      }
      if (s.lifecycle.pullRequest && !s.archived) {
        const pr = await pullRequest(
          this.c.root,
          s.branch,
          s.lifecycle.pullRequest.number,
        );
        if (pr && ["MERGED", "CLOSED"].includes(pr.state)) {
          await this.update({
            ...s.lifecycle,
            status: pr.state === "MERGED" ? "merged" : "closed",
            detail:
              pr.state === "MERGED"
                ? "Merged on GitHub"
                : "PR closed without merging",
          });
          await this.refresh();
          return;
        }
      }
      if (!s.archived) await this.reconcile();
    } catch (e: any) {
      this.c.state.brainStatus =
        "Sync paused · " + String(e.message).slice(0, 220);
      this.c.emitState();
    } finally {
      this.busy = false;
    }
  }
  async retry() {
    const recovery =
      this.c.context.workspaceState.get<Recovery>("reconciliation");
    if (recovery) {
      const choice = await vscode.window.showQuickPick(
        [
          "Open candidate to review",
          "Check and apply reviewed candidate",
          "Start a fresh update",
        ],
        { title: "Your working files are preserved" },
      );
      if (!choice) return;
      if (choice === "Open candidate to review") {
        await vscode.commands.executeCommand(
          "vscode.openFolder",
          vscode.Uri.file(recovery.candidate),
          { forceNewWindow: true },
        );
        return;
      }
      if (choice === "Start a fresh update")
        await this.c.context.workspaceState.update("reconciliation", undefined);
    }
    if (!recovery && this.c.client.session?.lifecycle?.status === "attention") {
      const before = await snapshot(this.c.root);
      await runChecks(this.c.root, await this.checks());
      const after = await snapshot(this.c.root);
      if (
        before.head !== after.head ||
        before.tree !== after.tree ||
        !this.idle()
      )
        throw Error("Work changed during checks. Review it before resuming.");
      const life = this.c.client.session.lifecycle;
      await this.update({
        ...life,
        status: life.pullRequest ? "review" : "active",
        detail: "Resumed after review",
      });
    }
    this.failedBase = undefined;
    await this.tick();
  }
  async finish() {
    if (this.busy)
      throw Error(
        "Lattice is checking session updates. Try again in a moment.",
      );
    const s = this.c.client.session;
    if (
      !s?.lifecycle ||
      s.people.find((p) => p.id === this.c.state.me)?.role !== "owner"
    )
      throw Error("The session owner publishes the pull request.");
    if (!this.idle())
      throw Error(
        "Finish active turns and save your edits before preparing the PR.",
      );
    this.busy = true;
    let publishing = false;
    try {
      await this.reconcile(true);
      if (this.c.client.session?.lifecycle?.status === "attention")
        throw Error("Resolve the session update before publishing.");
      await github(this.c.root, ["auth", "status"]);
      const checks = await this.checks();
      const verified = await snapshot(this.c.root);
      await runChecks(this.c.root, checks);
      const checked = await snapshot(this.c.root);
      if (
        verified.tree !== checked.tree ||
        verified.head !== checked.head ||
        !this.idle()
      )
        throw Error(
          "Files changed during validation. Save your work and prepare the PR again.",
        );
      const base = this.c.client.session!.lifecycle!.baseCommit;
      const patch = await git(this.c.root, ["diff", base, verified.commit]);
      const title = await vscode.window.showInputBox({
        title: "Pull request title",
        value: s.title,
      });
      if (!title) return;
      const description = `${title}\n\n${s.plan.map((p) => `- [${p.done ? "x" : " "}] ${p.text}`).join("\n")}\n\nValidation: ${checks.map((c) => c.join(" ")).join("; ")}`;
      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: `${description}\n\nChanges:\n\n${patch || "See Source Control for new files."}`,
      });
      await vscode.window.showTextDocument(doc);
      const reviewed = await git(this.c.root, ["status", "--porcelain"]);
      const reviewedSnapshot = verified;
      const choice = await vscode.window.showInformationMessage(
        "Publish this session branch and open a pull request on GitHub?",
        {
          modal: true,
          detail:
            "GitHub handles review and merging. Lattice will track the PR here.",
        },
        "Publish PR",
      );
      if (choice !== "Publish PR") return;
      await this.update({
        ...this.c.client.session!.lifecycle!,
        status: "reconciling",
        detail: "Publishing the reviewed branch…",
      });
      publishing = true;
      const now = await snapshot(this.c.root);
      if (
        reviewedSnapshot.tree !== now.tree ||
        reviewedSnapshot.head !== now.head ||
        reviewed !== (await git(this.c.root, ["status", "--porcelain"])) ||
        !this.idle()
      )
        throw Error("Changes arrived after review. Prepare the PR again.");
      await git(this.c.root, ["fetch", "origin", s.lifecycle.baseBranch]);
      if (
        (await git(this.c.root, ["rev-parse", "FETCH_HEAD^{commit}"])) !== base
      )
        throw Error(
          "The base branch changed during review. Prepare the PR again to reconcile and test it.",
        );
      const pr = await publishPullRequest(
        this.c.root,
        s.branch,
        s.lifecycle.baseBranch,
        title,
        description,
        reviewedSnapshot,
      );
      await this.update({
        ...this.c.client.session!.lifecycle!,
        status: "review",
        detail: "Awaiting review on GitHub",
        pullRequest: { number: pr.number, url: pr.url, head: pr.headRefOid },
      });
      await vscode.env.openExternal(vscode.Uri.parse(pr.url));
      await this.refresh();
    } finally {
      if (
        publishing &&
        this.c.client.session?.lifecycle?.status === "reconciling"
      ) {
        const life = this.c.client.session.lifecycle;
        await this.update({
          ...life,
          status: life.pullRequest ? "review" : "active",
          detail: "Ready",
        }).catch(() => {});
      }
      this.busy = false;
    }
  }
}
