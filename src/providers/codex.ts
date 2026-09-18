import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { type AgentHooks, type RunOptions, type Runner } from "./types";
export class CodexRunner implements Runner {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private hooks?: AgentHooks;
  private thread?: string;
  private turn?: string;
  private completion?: { resolve: () => void; reject: (e: Error) => void };
  private stopped = false;
  private stderr = "";
  constructor(private executable: string) {}
  private send(value: any) {
    if (!this.child?.stdin.writable)
      throw Error("Codex process is not running.");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  private rpc(method: string, params: unknown) {
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Codex ${method} timed out.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  private async receive(m: any) {
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      }
      return;
    }
    const p = m.params || {};
    const h = this.hooks;
    if (!h) return;
    if (m.id !== undefined) {
      try {
        let result: any;
        if (
          m.method === "item/commandExecution/requestApproval" ||
          m.method === "item/fileChange/requestApproval"
        ) {
          const ok = await h.approve(
            m.method.includes("fileChange") ? "Change files" : "Run command",
            JSON.stringify(p, null, 2),
          );
          result = { decision: ok ? "accept" : "decline" };
        } else if (m.method === "item/permissions/requestApproval") {
          const ok = await h.approve(
            "Additional permissions",
            JSON.stringify(p.permissions, null, 2),
          );
          result = { permissions: ok ? p.permissions : {}, scope: "turn" };
        } else if (m.method === "item/tool/requestUserInput") {
          const answers = await h.ask(p.questions || []);
          result = {
            answers: Object.fromEntries(
              Object.entries(answers).map(([k, v]) => [k, { answers: v }]),
            ),
          };
        } else if (m.method === "mcpServer/elicitation/request") {
          result = { action: "decline", content: null };
          h.tool("Declined an unsupported MCP elicitation.");
        } else {
          this.send({
            id: m.id,
            error: { code: -32601, message: "Unsupported client request" },
          });
          return;
        }
        this.send({ id: m.id, result });
      } catch {
        try {
          this.send({
            id: m.id,
            error: { code: -32000, message: "Request interrupted" },
          });
        } catch {}
      }
      return;
    }
    if (m.method === "turn/started") this.turn = p.turn.id;
    if (m.method === "item/agentMessage/delta") h.text(p.delta, p.itemId, true);
    if (m.method === "item/started") {
      const item = p.item || {};
      if (item.type === "commandExecution") {
        h.status(item.command || "Running command");
        h.tool(item.command || "Running command");
      } else if (item.type === "fileChange") {
        h.status("Editing files");
        h.tool(
          (item.changes || []).map((c: any) => c.path).join("\n") ||
            "Editing files",
        );
      } else if (item.type === "mcpToolCall") {
        h.status(`Using ${item.tool}`);
        h.tool(`${item.server}: ${item.tool}`);
      }
    }
    if (m.method === "item/completed") {
      const item = p.item || {};
      if (item.type === "agentMessage") h.text(item.text || "", item.id, false);
      if (item.type === "commandExecution" && item.aggregatedOutput)
        h.tool(item.aggregatedOutput.slice(-6000));
    }
    if (m.method === "thread/tokenUsage/updated") {
      const u = p.tokenUsage?.last;
      if (u) h.usage(u.inputTokens || 0, u.outputTokens || 0);
    }
    if (m.method === "turn/completed") {
      this.turn = undefined;
      const t = p.turn;
      if (t.status === "failed")
        this.completion?.reject(Error(t.error?.message || "Codex turn failed"));
      else this.completion?.resolve();
      this.completion = undefined;
    }
    if (m.method === "error" && !p.willRetry)
      this.completion?.reject(Error(p.error?.message || "Codex error"));
  }
  async run(o: RunOptions) {
    this.hooks = o.hooks;
    this.stopped = false;
    this.child = spawn(
      this.executable,
      ["app-server", "--listen", "stdio://"],
      { cwd: o.cwd, env: process.env, stdio: "pipe" },
    );
    this.child.stderr.on("data", (d) => {
      this.stderr = (this.stderr + d).slice(-3000);
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        void this.receive(JSON.parse(line));
      } catch {}
    });
    const fail = (e: Error) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      this.pending.clear();
      if (this.stopped) this.completion?.resolve();
      else this.completion?.reject(e);
    };
    this.child.once("error", fail);
    this.child.once("exit", (code) =>
      fail(Error(`Codex exited (${code}). ${this.stderr}`)),
    );
    await this.rpc("initialize", {
      clientInfo: {
        name: "lattice_session",
        title: "Lattice Session",
        version: "0.1.0",
      },
      capabilities: {},
    });
    this.send({ method: "initialized", params: {} });
    const config = {
      cwd: o.cwd,
      model: o.model || null,
      sandbox: o.mode === "read-only" ? "read-only" : "workspace-write",
      approvalPolicy: o.mode === "read-only" ? "never" : "on-request",
      approvalsReviewer: "user",
    };
    const result = await this.rpc(
      o.resume ? "thread/resume" : "thread/start",
      o.resume ? { ...config, threadId: o.resume } : config,
    );
    this.thread = result.thread.id;
    const done = new Promise<void>((resolve, reject) => {
      this.completion = { resolve, reject };
    });
    void done.catch(() => {});
    try {
      await this.rpc("turn/start", {
        threadId: this.thread,
        input: [{ type: "text", text: o.prompt, text_elements: [] }],
      });
      await done;
      return this.thread;
    } finally {
      this.dispose();
    }
  }
  async steer(text: string) {
    if (!this.thread || !this.turn)
      throw Error("The turn finished. Send this as a new prompt.");
    await this.rpc("turn/steer", {
      threadId: this.thread,
      expectedTurnId: this.turn,
      input: [{ type: "text", text, text_elements: [] }],
    });
  }
  async stop() {
    this.stopped = true;
    if (this.thread && this.turn)
      try {
        await this.rpc("turn/interrupt", {
          threadId: this.thread,
          turnId: this.turn,
        });
      } catch {}
    this.dispose();
    this.completion?.resolve();
  }
  dispose() {
    this.child?.kill("SIGTERM");
    this.child = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Codex connection closed."));
    }
    this.pending.clear();
  }
}
