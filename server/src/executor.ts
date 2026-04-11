import { spawn, execSync } from 'child_process';
import path from 'path';
import { normalize, isAbsolute } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { IntentSpec } from './planner';

export interface AgentResult {
  /** The intent spec this agent was working on. */
  spec: IntentSpec;
  /** Human-readable agent identifier (priority + short UUID). */
  agentName: string;
  /** Full UUID for the agent run. */
  agentId: string;
  /** Unified diff of all changes the agent made (empty string if none). */
  diff: string;
  /** Whether the agent completed without error. */
  success: boolean;
  /** Error message if success is false. */
  error?: string;
}

/**
 * Async, non-blocking check that the claude CLI binary is present and executable.
 * Uses spawn rather than execSync to avoid blocking the event loop.
 */
export function claudeAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn('claude', ['--version'], { stdio: 'ignore' });
    const timer = setTimeout(() => { proc.kill(); resolve(false); }, 5000);
    proc.on('close', code => { clearTimeout(timer); resolve(code === 0); });
    proc.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/**
 * Validates and normalises a repository path supplied by the client.
 *
 * Rejects relative paths and any path containing traversal sequences (`..`)
 * to prevent path traversal / command injection via the repoPath parameter.
 *
 * @returns The normalised absolute path, or null if the path is invalid.
 */
export function sanitizeRepoPath(repoPath: unknown): string | null {
  if (typeof repoPath !== 'string' || !repoPath.trim()) return null;
  const normalised = normalize(repoPath.trim());
  if (!isAbsolute(normalised)) return null;
  // Reject any residual traversal sequences after normalisation
  if (normalised.split(path.sep).some(part => part === '..')) return null;
  return normalised;
}

/**
 * Spawns an isolated Claude Code agent to implement a single IntentSpec.
 *
 * Isolation strategy:
 *  1. If the target directory is a git repo, a temporary worktree is created
 *     at `../lattice-wt-<agentId>` so the agent's changes don't pollute the
 *     working tree of other concurrently running agents.
 *  2. The Claude CLI is invoked with `--dangerously-skip-permissions --print`
 *     and the task prompt is written to stdin to avoid shell-escaping issues.
 *  3. After the agent finishes, a unified diff is captured via `git diff --cached`
 *     (or `git diff` / manual diff for untracked files as fallback).
 *  4. The worktree is always cleaned up in the `finally` block.
 *
 * @param spec      The coding task for this agent to complete.
 * @param repoPath  Absolute path to the repository root (must pass sanitizeRepoPath).
 * @param onProgress  Callback for live progress messages sent to the client.
 */
export async function spawnCodingAgent(
  spec: IntentSpec,
  repoPath: string,
  onProgress: (msg: string) => void,
): Promise<AgentResult> {
  const agentId = uuidv4();
  const agentName = `agent-${spec.priority}-${agentId.slice(0, 6)}`;

  // Check if this is a git repo
  let isGitRepo = false;
  try {
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'ignore' });
    isGitRepo = true;
  } catch {}

  let worktreeDir: string | null = null;

  try {
    // Try to create an isolated git worktree
    if (isGitRepo) {
      worktreeDir = path.join(repoPath, '..', `lattice-wt-${agentId.slice(0, 8)}`);
      try {
        execSync(`git worktree add "${worktreeDir}" HEAD`, { cwd: repoPath, timeout: 10000 });
        onProgress(`Worktree ready for: ${spec.description.slice(0, 50)}`);
      } catch {
        worktreeDir = null; // fall back to working directly in repo
      }
    }

    const activeDir = worktreeDir ?? repoPath;

    const prompt = [
      `You are a coding agent. Implement the task below by actually writing files to disk using your tools. Do not describe what you would do — just do it.`,
      ``,
      `TASK: ${spec.description}`,
      `TARGET FILES: ${spec.filePaths.join(', ')}`,
      spec.functionNames.length ? `FUNCTIONS: ${spec.functionNames.join(', ')}` : '',
      `WORKING DIRECTORY: ${activeDir}`,
      ``,
      `Rules:`,
      `- Use the Write or Edit tool to create/modify the files listed`,
      `- If a directory doesn't exist, create it first with Bash (mkdir -p)`,
      `- Write real, working content — not placeholders`,
      `- Only touch the files listed above`,
      `- When done, stop immediately`,
    ].filter(Boolean).join('\n');

    onProgress(`Agent running: ${spec.description.slice(0, 50)}...`);

    await runClaude(prompt, activeDir);

    // Capture what changed — stage everything first so new untracked files are included
    let diff = '';
    if (isGitRepo) {
      try {
        execSync('git add -A', { cwd: activeDir, timeout: 10000 });
        diff = execSync('git diff --cached', { cwd: activeDir, maxBuffer: 4 * 1024 * 1024 }).toString();
      } catch {}

      // Fallback: unstaged changes
      if (!diff) {
        try {
          diff = execSync('git diff', { cwd: activeDir, maxBuffer: 4 * 1024 * 1024 }).toString();
        } catch {}
      }

      // Last resort: manually build diff for any remaining untracked files
      if (!diff) {
        try {
          const untracked = execSync('git ls-files --others --exclude-standard', {
            cwd: activeDir, timeout: 5000,
          }).toString().trim().split('\n').filter(Boolean);

          const { readFileSync } = await import('fs');
          for (const file of untracked) {
            try {
              const content = readFileSync(path.join(activeDir, file), 'utf8');
              const lines = content.split('\n');
              diff += [
                `diff --git a/${file} b/${file}`,
                'new file mode 100644',
                '--- /dev/null',
                `+++ b/${file}`,
                `@@ -0,0 +1,${lines.length} @@`,
                ...lines.map(l => `+${l}`),
                '',
              ].join('\n');
            } catch {}
          }
        } catch {}
      }
    }

    onProgress(`Agent finished: ${spec.description.slice(0, 50)}`);

    return { spec, agentName, agentId, diff, success: true };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    onProgress(`Agent failed: ${spec.description.slice(0, 40)} — ${msg.slice(0, 80)}`);
    return { spec, agentName, agentId, diff: '', success: false, error: msg };
  } finally {
    if (worktreeDir) {
      try {
        execSync(`git worktree remove "${worktreeDir}" --force`, { cwd: repoPath, timeout: 10000 });
      } catch {}
    }
  }
}

function resolveClaudePath(): string {
  // Explicit override wins only if non-empty
  const override = process.env.CLAUDE_PATH?.trim();
  if (override) return override;

  // Try to find claude on PATH right now (server's PATH may differ from user shell)
  try {
    const found = execSync('which claude', { encoding: 'utf8', timeout: 5000 }).trim();
    if (found) return found;
  } catch {}
  try {
    const found = execSync('command -v claude', { encoding: 'utf8', timeout: 5000 }).trim();
    if (found) return found;
  } catch {}

  // Common install locations
  const candidates = [
    '/usr/local/bin/claude',
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.npm-global/bin/claude`,
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    try { execSync(`test -x "${c}"`, { stdio: 'ignore' }); return c; } catch {}
  }

  return 'claude'; // last resort
}

function runClaude(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const claudeCmd = resolveClaudePath();

    if (!claudeCmd) {
      reject(new Error('claude CLI not found. Install it: npm install -g @anthropic-ai/claude-code'));
      return;
    }

    // Pipe prompt via stdin — avoids shell-escaping issues with multi-line prompts
    // that contain quotes, backticks, or newlines.
    // --dangerously-skip-permissions: allow Write/Bash tools without confirmation prompts.
    // --print: non-interactive, exit when done.
    // No shell:true so the args are passed directly to the process (no shell interpolation).
    const proc = spawn(claudeCmd, ['--dangerously-skip-permissions', '--print'], {
      cwd,
      timeout: 180_000, // 3 min max per agent
      env: { ...process.env, TERM: 'dumb' },
    });

    // Write prompt to stdin then close so claude stops waiting for input
    proc.stdin?.write(prompt + '\n');
    proc.stdin?.end();

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code: number | null) => {
      if (code === 0 || code === null) resolve(stdout);
      else reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 300)}`));
    });

    proc.on('error', (err: Error) => {
      if ((err as any).code === 'ENOENT') {
        reject(new Error('claude CLI not found. Install it: npm install -g @anthropic-ai/claude-code'));
      } else {
        reject(err);
      }
    });
  });
}
