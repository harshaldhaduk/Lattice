import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CodexRunner } from "../providers/codex";
import { ClaudeRunner } from "../providers/claude";
import { redact, type Runner } from "../providers/types";
import type { AppState, Provider, AgentStatus } from "../shared/protocol";
import { SessionClient } from "../shared/client";
import { isProviderLimit } from "../providers/limits";
import { createTaskTree, taskPatch, type TaskTree } from "./git";
import { LiveSync } from "./live-sync";
import { reserveWork, LiveTeamContext } from "./coordination";

export class TaskExecutor {
  readonly id: string = randomUUID();
  private runner?: Runner;
  private live: LiveSync;
  private stopped = false;
  private approvals = new Map<
    string,
    { resolve: (v: boolean) => void; timer: NodeJS.Timeout }
  >();
  private listener: () => void;
  private pendingText = new Map<string, string>();
  private flushTimer?: NodeJS.Timeout;
  private complete?: Promise<void>;
  constructor(
    private client: SessionClient,
    private context: vscode.ExtensionContext,
    private root: string,
    private state: () => AppState,
    private paths: Record<Provider, string>,
    private treeChanged: (tree: TaskTree) => Promise<void>,
    private changed: () => void,
  ) {
    this.live = new LiveSync(client, () => root, state, changed);
    this.listener = () => {
      for (const [id, waiting] of this.approvals) {
        const approval = client.session?.approvals.find((a) => a.id === id);
        if (approval && approval.status !== "pending") {
          clearTimeout(waiting.timer);
          waiting.resolve(approval.status === "approved");
          this.approvals.delete(id);
        }
      }
    };
    client.on("state", this.listener);
  }
  start(
    prompt: string,
    provider: Provider,
    model: string,
    mode: "ask" | "read-only",
  ) {
    this.complete = this.execute(prompt, provider, model, mode);
    return this.complete;
  }
  private async execute(
    prompt: string,
    provider: Provider,
    model: string,
    mode: "ask" | "read-only",
  ) {
    const status = (status: AgentStatus, detail: string) =>
      this.client.event({
        type: "agent",
        isolated: true,
        provider,
        runId: this.id,
        task: prompt.slice(0, 2000),
        status,
        detail: detail.slice(0, 2000),
      });
    let tree: TaskTree | undefined;
    let release: (() => Promise<void>) | undefined;
    let team: LiveTeamContext | undefined;
    const flush = async () => {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
      const entries = [...this.pendingText];
      this.pendingText.clear();
      for (const [entryId, text] of entries)
        await this.client.event({
          type: "entry",
          kind: "agent",
          provider,
          runId: this.id,
          entryId,
          text: redact(text).slice(-32000),
        });
    };
    const chunks = new Map<string, string>();
    try {
      release = await reserveWork(
        this.client,
        this.id,
        prompt,
        mode === "read-only",
        this.state().file,
        this.state().conflictSensitivity || 6,
        async () => {
          this.stopped = true;
          await this.runner?.stop();
        },
        () => this.stopped,
      );
      await status("running", "Preparing an isolated task worktree");
      tree = await createTaskTree(
        this.root,
        join(this.context.globalStorageUri.fsPath, "worktrees"),
        this.id,
      );
      tree.status = "running";
      await this.treeChanged(tree);
      if (this.stopped) return;
      await this.client.event({
        type: "entry",
        kind: "message",
        provider,
        runId: this.id,
        text: prompt,
      });
      this.runner =
        provider === "codex"
          ? new CodexRunner(this.paths.codex)
          : new ClaudeRunner(
              this.paths.claude,
              join(this.context.extensionPath, "dist", "claude-sdk.mjs"),
            );
      await this.live.begin(tree.path, this.id, true);
      team = new LiveTeamContext(this.client, tree.path, this.id);
      await team.start();
      await this.runner.run({
        cwd: tree.path,
        model,
        mode,
        prompt: `${team.prompt(prompt)}\nWork only in this isolated task checkout.`,
        hooks: {
          text: (text, key, append) => {
            if (
              !vscode.workspace
                .getConfiguration("lattice")
                .get("shareTranscripts", true)
            )
              return;
            const id = this.id + ":" + (key || randomUUID());
            const value = (append ? (chunks.get(id) || "") + text : text).slice(
              -32000,
            );
            chunks.set(id, value);
            this.pendingText.set(id, value);
            if (!this.flushTimer)
              this.flushTimer = setTimeout(
                () => void flush().catch(() => {}),
                150,
              );
          },
          tool: (text) => {
            if (
              vscode.workspace
                .getConfiguration("lattice")
                .get("shareTranscripts", true)
            )
              void this.client
                .event({
                  type: "entry",
                  kind: "tool",
                  text: redact(text).slice(-8000),
                  provider,
                  runId: this.id,
                })
                .catch(() => {});
          },
          usage: (input, output, cost) => {
            void this.client
              .event({
                type: "usage",
                runId: this.id,
                provider,
                input,
                output,
                cost,
              })
              .catch(() => {});
          },
          status: (detail) => {
            if (!this.stopped) void status("running", detail).catch(() => {});
          },
          approve: async (title, detail) => {
            if (this.stopped) return false;
            const id = randomUUID();
            await status("approval", title);
            const result = new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                this.approvals.delete(id);
                resolve(false);
                void this.client
                  .event({ type: "approval.decide", id, approve: false })
                  .catch(() => {});
              }, 120000);
              this.approvals.set(id, { resolve, timer });
            });
            try {
              await this.client.event({
                type: "approval.add",
                id,
                runId: this.id,
                title,
                detail: redact(detail).slice(0, 12000),
              });
            } catch {
              const waiter = this.approvals.get(id);
              if (waiter) {
                clearTimeout(waiter.timer);
                waiter.resolve(false);
                this.approvals.delete(id);
              }
            }
            const allowed = await result;
            if (!this.stopped)
              await status("running", allowed ? "Approved" : "Denied");
            return allowed;
          },
          ask: async (questions) => {
            const answers: Record<string, string[]> = {};
            for (const q of questions) {
              const answer = q.options?.length
                ? await vscode.window.showQuickPick(
                    q.options.map((o) => o.label),
                    { title: q.question },
                  )
                : await vscode.window.showInputBox({ title: q.question });
              answers[q.id] = answer ? [answer] : [];
            }
            return answers;
          },
        },
      });
      await this.live.finish();
      await flush();
      await status(
        this.stopped ? "stopped" : "done",
        this.stopped ? "Stopped" : "Ready for review",
      );
    } catch (e: any) {
      if (!this.stopped && isProviderLimit(e)) {
        await this.live.finish();
        await flush();
        await status(
          "limited",
          "Usage limit reached · a teammate can continue",
        );
        const patch = tree ? await taskPatch(tree) : "";
        if (patch.length > 120000)
          throw Error(
            "Usage limit reached. This task patch is too large to transfer automatically; its worktree is preserved.",
          );
        await this.client.event({
          type: "handoff.limit",
          runId: this.id,
          artifact:
            tree && patch.trim() ? { base: tree.base, patch } : undefined,
        });
      } else {
        await status(this.stopped ? "stopped" : "error", e.message).catch(
          () => {},
        );
        if (!this.stopped) throw e;
      }
    } finally {
      team?.dispose();
      await release?.();
      await this.live.finish();
      this.live.dispose();
      clearTimeout(this.flushTimer);
      this.runner?.dispose();
      this.runner = undefined;
      for (const waiter of this.approvals.values()) {
        clearTimeout(waiter.timer);
        waiter.resolve(false);
      }
      this.approvals.clear();
      this.client.off("state", this.listener);
      if (tree) {
        tree.status = "review";
        await this.treeChanged(tree);
      }
      this.changed();
    }
  }
  async steer(text: string) {
    if (!this.runner?.steer)
      throw Error("This task cannot accept live guidance.");
    await this.runner.steer(text);
  }
  async stop() {
    this.stopped = true;
    for (const waiter of this.approvals.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve(false);
    }
    this.approvals.clear();
    await this.runner?.stop();
    await this.complete?.catch(() => {});
  }
}
