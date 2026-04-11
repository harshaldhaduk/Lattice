#!/usr/bin/env node
/**
 * Lattice MCP Server
 * Exposes Lattice coordination tools to Claude Code agents via the Model Context Protocol.
 *
 * Usage:
 *   npx ts-node src/mcp.ts
 *   # or compile and run:
 *   node out/mcp.js
 *
 * Required environment variables:
 *   LATTICE_SERVER_URL   — defaults to http://localhost:3001
 *   LATTICE_SESSION_ID   — the active session UUID
 *   LATTICE_PARTICIPANT_ID — the agent's participant UUID
 *
 * Register with Claude Code:
 *   claude mcp add lattice -- node /path/to/out/mcp.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const SERVER_URL      = process.env.LATTICE_SERVER_URL    ?? 'http://localhost:3001';
const SESSION_ID      = process.env.LATTICE_SESSION_ID    ?? '';
const PARTICIPANT_ID  = process.env.LATTICE_PARTICIPANT_ID ?? '';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as any).error ?? `HTTP ${res.status}`);
  return json;
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}/api${path}`);
  const json = await res.json();
  if (!res.ok) throw new Error((json as any).error ?? `HTTP ${res.status}`);
  return json;
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'lattice',
  version: '0.1.0',
});

// ── Tool: lattice_register_intent ─────────────────────────────────────────────

server.tool(
  'lattice_register_intent',
  'Register an intent to modify specific files or functions. Call this BEFORE you start editing code to prevent conflicts with teammates and other agents.',
  {
    description:   z.string().describe('What you plan to do (e.g. "Refactor verifyToken to support JWT RS256")'),
    filePaths:     z.array(z.string()).describe('Relative file paths you will touch'),
    functionNames: z.array(z.string()).optional().describe('Function names you will modify'),
    startLine:     z.number().optional().describe('Start line of the edit range'),
    endLine:       z.number().optional().describe('End line of the edit range'),
    priority:      z.enum(['blocking', 'normal', 'background']).optional().describe('Intent priority'),
  },
  async ({ description, filePaths, functionNames, startLine, endLine, priority }) => {
    if (!SESSION_ID || !PARTICIPANT_ID) {
      return { content: [{ type: 'text', text: 'Error: LATTICE_SESSION_ID and LATTICE_PARTICIPANT_ID must be set.' }] };
    }

    try {
      const intent = await post('/intents', {
        sessionId: SESSION_ID,
        participantId: PARTICIPANT_ID,
        description,
        filePaths,
        functionNames: functionNames ?? [],
        startLine,
        endLine,
        priority: priority ?? 'normal',
      }) as any;

      return {
        content: [{
          type: 'text',
          text: `Intent registered. ID: ${intent.id}\nFiles: ${intent.filePaths.join(', ')}\nStatus: ${intent.status}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error registering intent: ${err}` }] };
    }
  },
);

// ── Tool: lattice_check_edit ──────────────────────────────────────────────────

server.tool(
  'lattice_check_edit',
  'Check whether editing a file will conflict with another active participant. Call this BEFORE applying a diff to a file.',
  {
    intentId:      z.string().describe('Your active intent ID'),
    filePath:      z.string().describe('Relative path of the file you are about to edit'),
    diff:          z.string().optional().describe('The proposed diff (optional, for context)'),
    functionNames: z.array(z.string()).optional().describe('Functions you are modifying'),
    startLine:     z.number().optional().describe('Start line of the edit'),
    endLine:       z.number().optional().describe('End line of the edit'),
  },
  async ({ intentId, filePath, diff, functionNames, startLine, endLine }) => {
    if (!SESSION_ID || !PARTICIPANT_ID) {
      return { content: [{ type: 'text', text: 'Error: LATTICE_SESSION_ID and LATTICE_PARTICIPANT_ID must be set.' }] };
    }

    try {
      const result = await post('/edits/check', {
        sessionId: SESSION_ID,
        participantId: PARTICIPANT_ID,
        intentId,
        filePath,
        diff: diff ?? '',
        functionNames: functionNames ?? [],
        startLine,
        endLine,
      }) as any;

      const conflictLines = (result.conflicts ?? [])
        .map((c: any) => `  - ${c.participantName} (${c.actorType}): ${c.description} [${c.overlapType}]`)
        .join('\n');

      return {
        content: [{
          type: 'text',
          text: [
            `Verdict: ${result.verdict}`,
            `Message: ${result.message}`,
            result.conflicts?.length > 0 ? `Conflicts:\n${conflictLines}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error checking edit: ${err}` }] };
    }
  },
);

// ── Tool: lattice_propose_patch ───────────────────────────────────────────────

server.tool(
  'lattice_propose_patch',
  'Stage a shadow patch for review by teammates. Use this when lattice_check_edit returns REVIEW or CONFLICT and you still need to make the change.',
  {
    intentId: z.string().describe('Your active intent ID'),
    filePath: z.string().describe('Relative path of the file being modified'),
    diff:     z.string().describe('The unified diff of your proposed changes'),
    reason:   z.string().describe('Why this change is needed'),
  },
  async ({ intentId, filePath, diff, reason }) => {
    if (!SESSION_ID || !PARTICIPANT_ID) {
      return { content: [{ type: 'text', text: 'Error: LATTICE_SESSION_ID and LATTICE_PARTICIPANT_ID must be set.' }] };
    }

    try {
      const patch = await post('/patches', {
        sessionId: SESSION_ID,
        intentId,
        proposerId: PARTICIPANT_ID,
        filePath,
        diff,
        reason,
      }) as any;

      return {
        content: [{
          type: 'text',
          text: `Shadow patch staged. ID: ${patch.id}\nStatus: ${patch.status}\nExpires: ${patch.expiresAt}\nYour teammates will be notified to review it.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error proposing patch: ${err}` }] };
    }
  },
);

// ── Tool: lattice_get_session_context ─────────────────────────────────────────

server.tool(
  'lattice_get_session_context',
  'Get the current session state: who is online, what files they own, and any pending patches. Call this at the start of a coding task to understand the coordination landscape.',
  {},
  async () => {
    if (!SESSION_ID) {
      return { content: [{ type: 'text', text: 'Error: LATTICE_SESSION_ID must be set.' }] };
    }

    try {
      const state = await get(`/sessions/${SESSION_ID}/state`) as any;

      const participantSummary = (state.participants ?? [])
        .map((p: any) => `  ${p.name} (${p.actorType}) — ${p.status}${p.currentTask ? `: ${p.currentTask}` : ''}`)
        .join('\n');

      const intentSummary = (state.intents ?? [])
        .filter((i: any) => i.status === 'in_progress')
        .map((i: any) => `  [${i.priority}] ${i.participantName}: "${i.description}" → ${i.filePaths.join(', ')}`)
        .join('\n');

      const patchSummary = (state.patches ?? [])
        .filter((p: any) => p.status === 'pending')
        .map((p: any) => `  ${p.proposerName}: ${p.filePath} — "${p.reason}"`)
        .join('\n');

      return {
        content: [{
          type: 'text',
          text: [
            `Session: ${state.session?.name} (${SESSION_ID})`,
            '',
            'PARTICIPANTS:',
            participantSummary || '  (none)',
            '',
            'ACTIVE INTENTS:',
            intentSummary || '  (none)',
            '',
            'PENDING PATCHES:',
            patchSummary || '  (none)',
          ].join('\n'),
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error fetching session context: ${err}` }] };
    }
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Lattice MCP server running on stdio\n');
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
