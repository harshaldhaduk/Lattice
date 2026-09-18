import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type {
  Query,
  Options,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { type Runner, type RunOptions } from "./types";
export class ClaudeRunner implements Runner {
  private query?: Query;
  private abort = new AbortController();
  private messages: SDKUserMessage[] = [];
  private wake?: () => void;
  private pendingTurns = 0;
  private accepting = false;
  private async *input(): AsyncIterable<SDKUserMessage> {
    while (!this.abort.signal.aborted) {
      if (this.messages.length) yield this.messages.shift()!;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
  async steer(text: string) {
    if (!this.accepting)
      throw Error("This turn has finished. Send a new prompt.");
    this.pendingTurns++;
    this.messages.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    this.wake?.();
  }
  constructor(
    private executable: string,
    private sdkPath?: string,
  ) {}
  async run(o: RunOptions) {
    const sdk: typeof import("@anthropic-ai/claude-agent-sdk") = await import(
      this.sdkPath
        ? pathToFileURL(this.sdkPath).href
        : "@anthropic-ai/claude-agent-sdk"
    );
    const options: Options = {
      cwd: o.cwd,
      pathToClaudeCodeExecutable: this.executable,
      model: o.model || undefined,
      resume: o.resume,
      abortController: this.abort,
      permissionMode: o.mode === "read-only" ? "plan" : "default",
      includePartialMessages: true,
      settingSources: ["user", "project"],
      canUseTool: async (name, input, { signal }) => {
        if (signal.aborted || this.abort.signal.aborted)
          return { behavior: "deny", message: "Run stopped" };
        const allow = await o.hooks.approve(
          name,
          JSON.stringify(input, null, 2),
        );
        return allow
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "Declined by session participant" };
      },
    };
    this.accepting = true;
    await this.steer(o.prompt);
    this.query = sdk.query({ prompt: this.input(), options });
    let session: string | undefined;
    let active = "";
    let block = 0;
    for await (const m of this.query) {
      if ("session_id" in m) session = m.session_id;
      if (m.type === "stream_event") {
        const e = m.event as any;
        if (e.type === "message_start") {
          active = e.message?.id || crypto.randomUUID();
        }
        if (e.type === "content_block_start") {
          block = e.index;
          if (e.content_block?.type === "tool_use") {
            o.hooks.status(`Using ${e.content_block.name}`);
            o.hooks.tool(e.content_block.name);
          }
        }
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta")
          o.hooks.text(e.delta.text, `${active}-${e.index ?? block}`, true);
      }
      if (m.type === "assistant") {
        for (const [index, b] of m.message.content.entries()) {
          if (b.type === "text")
            o.hooks.text(b.text, `${m.message.id}-${index}`, false);
          if (b.type === "tool_use") {
            o.hooks.tool(
              `${b.name}\n${JSON.stringify(b.input, null, 2).slice(0, 4000)}`,
            );
          }
        }
      }
      if (
        m.type === "rate_limit_event" &&
        m.rate_limit_info.status === "rejected"
      )
        throw Error(
          "Provider rate limit rejected: a teammate can continue this task.",
        );
      if (m.type === "result") {
        o.hooks.usage(
          m.usage.input_tokens +
            (m.usage.cache_read_input_tokens || 0) +
            (m.usage.cache_creation_input_tokens || 0),
          m.usage.output_tokens,
          m.total_cost_usd,
        );
        if (m.is_error)
          throw Error(
            "errors" in m ? m.errors.join("\n") : "Claude run failed",
          );
        this.pendingTurns--;
        if (this.pendingTurns <= 0) {
          this.accepting = false;
          break;
        }
      }
    }
    return session;
  }
  async stop() {
    this.accepting = false;
    this.abort.abort();
    this.wake?.();
    try {
      await this.query?.interrupt();
    } catch {}
  }
  dispose() {
    this.accepting = false;
    this.abort.abort();
    this.wake?.();
    this.query?.close();
  }
}
