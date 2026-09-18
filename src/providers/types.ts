export interface AgentHooks {
  text: (text: string, id?: string, append?: boolean) => void;
  tool: (text: string) => void;
  usage: (input: number, output: number, cost?: number) => void;
  approve: (title: string, detail: string) => Promise<boolean>;
  ask: (
    questions: {
      id: string;
      question: string;
      options?: { label: string }[];
    }[],
  ) => Promise<Record<string, string[]>>;
  status: (detail: string) => void;
}
export interface RunOptions {
  cwd: string;
  prompt: string;
  model?: string;
  mode: "ask" | "read-only";
  resume?: string;
  hooks: AgentHooks;
}
export interface Runner {
  run(options: RunOptions): Promise<string | undefined>;
  stop(): Promise<void>;
  steer?(text: string): Promise<void>;
  dispose(): void;
}
export function redact(s: string) {
  return s
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      "[redacted]",
    )
    .replace(
      /((?:api[_-]?key|authorization|password|secret|token)\s*[:=]\s*)["']?[^\s"',;]{8,}/gi,
      "$1[redacted]",
    );
}
