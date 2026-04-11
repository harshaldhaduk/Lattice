import { spawn, execSync } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { IntentSpec } from './planner';

export interface AgentResult {
  spec: IntentSpec;
  agentName: string;
  agentId: string;
  diff: string;
  success: boolean;
  error?: string;
}

// Check if claude CLI is available
export function claudeAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Run one coding agent for one intent spec
// repoPath: absolute path to the git repo (workspace folder)
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
      `You are a coding agent implementing exactly one task. Be concise and focused.`,
      ``,
      `TASK: ${spec.description}`,
      `FILES TO MODIFY: ${spec.filePaths.join(', ')}`,
      spec.functionNames.length ? `FUNCTIONS TO MODIFY: ${spec.functionNames.join(', ')}` : '',
      ``,
      `Instructions:`,
      `- Implement the task described above`,
      `- Only modify the files listed`,
      `- Write clean, production-quality TypeScript`,
      `- Do not add extra comments, tests, or unrelated changes`,
      `- When done, stop`,
    ].filter(Boolean).join('\n');

    onProgress(`Agent running: ${spec.description.slice(0, 50)}...`);

    await runClaude(prompt, activeDir);

    // Capture what changed
    let diff = '';
    if (isGitRepo) {
      try {
        diff = execSync(`git diff HEAD`, { cwd: activeDir, maxBuffer: 1024 * 1024 }).toString();
        if (!diff) {
          diff = execSync(`git diff`, { cwd: activeDir, maxBuffer: 1024 * 1024 }).toString();
        }
      } catch {}
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

function runClaude(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const claudeCmd = process.env.CLAUDE_PATH ?? 'claude';

    // claude -p runs non-interactively and exits when done
    const proc = spawn(claudeCmd, ['-p', prompt], {
      cwd,
      timeout: 180_000, // 3 min max per agent
      env: { ...process.env, TERM: 'xterm' },
      shell: true,
    });

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
