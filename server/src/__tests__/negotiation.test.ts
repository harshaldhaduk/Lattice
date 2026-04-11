/**
 * Tests for the negotiation orchestrator.
 *
 * Mocks the Anthropic SDK so no real API calls are made.
 * Verifies that the prompt structure is correct and that the
 * SEQUENCE/PARALLEL/MERGE/ESCALATE resolution types are parsed and
 * validated correctly by the Zod schema.
 */
process.env.NODE_ENV = 'test';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Anthropic SDK before importing the module under test ─────────────────

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { negotiateConflict } from '../negotiation';
import type { Intent, CheckEditRequest, ConflictDetail } from '@lattice/shared';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseRequest: CheckEditRequest = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  participantId: '00000000-0000-0000-0000-000000000002',
  intentId: '00000000-0000-0000-0000-000000000003',
  filePath: 'src/auth/middleware.ts',
  diff: '+export function verifyToken() {}',
  functionNames: ['verifyToken'],
};

const baseIntent: Intent = {
  id: '00000000-0000-0000-0000-000000000003',
  sessionId: '00000000-0000-0000-0000-000000000001',
  participantId: '00000000-0000-0000-0000-000000000002',
  participantName: 'Alice',
  actorType: 'human',
  description: 'Add auth middleware',
  filePaths: ['src/auth/middleware.ts'],
  functionNames: ['verifyToken'],
  status: 'in_progress',
  priority: 'blocking',
  createdAt: new Date().toISOString(),
};

const conflicts: ConflictDetail[] = [
  {
    intentId: '00000000-0000-0000-0000-000000000099',
    participantName: 'Bob',
    actorType: 'agent',
    description: 'Refactor auth middleware',
    filePath: 'src/auth/middleware.ts',
    functionNames: ['verifyToken'],
    overlapType: 'function',
  },
];

function mockResponse(json: object) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('negotiateConflict', () => {
  beforeEach(() => { mockCreate.mockReset(); });

  it('returns a SEQUENCE resolution when LLM says SEQUENCE', async () => {
    mockResponse({ type: 'SEQUENCE', first: 'Alice', second: 'Bob', reasoning: 'Alice goes first' });
    const result = await negotiateConflict(baseRequest, baseIntent, conflicts);
    expect(result.type).toBe('SEQUENCE');
    if (result.type === 'SEQUENCE') {
      expect(result.first).toBe('Alice');
      expect(result.second).toBe('Bob');
      expect(result.reasoning).toBeTruthy();
    }
  });

  it('returns a PARALLEL resolution', async () => {
    mockResponse({ type: 'PARALLEL', reasoning: 'No real overlap' });
    const result = await negotiateConflict(baseRequest, baseIntent, conflicts);
    expect(result.type).toBe('PARALLEL');
  });

  it('returns a MERGE resolution', async () => {
    mockResponse({ type: 'MERGE', combinedApproach: 'Combine both changes', reasoning: 'Can merge' });
    const result = await negotiateConflict(baseRequest, baseIntent, conflicts);
    expect(result.type).toBe('MERGE');
    if (result.type === 'MERGE') {
      expect(result.combinedApproach).toBeTruthy();
    }
  });

  it('escalates when LLM returns invalid JSON', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not valid json at all' }] });
    const result = await negotiateConflict(baseRequest, baseIntent, conflicts);
    expect(result.type).toBe('ESCALATE');
  });

  it('escalates when LLM returns a JSON object that fails Zod validation', async () => {
    // Missing required 'first' and 'second' fields for SEQUENCE
    mockResponse({ type: 'SEQUENCE', reasoning: 'incomplete' });
    const result = await negotiateConflict(baseRequest, baseIntent, conflicts);
    expect(result.type).toBe('ESCALATE');
  });

  it('escalates when the API call rejects', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API unavailable'));
    const result = await negotiateConflict(baseRequest, baseIntent, conflicts);
    expect(result.type).toBe('ESCALATE');
    expect(result.reasoning).toContain('API unavailable');
  });

  it('escalates on timeout (NEGOTIATION_TIMEOUT_MS=1)', async () => {
    process.env.NEGOTIATION_TIMEOUT_MS = '1';
    // Delay response past the 1ms timeout
    mockCreate.mockImplementationOnce(
      () => new Promise(resolve => setTimeout(() =>
        resolve({ content: [{ type: 'text', text: JSON.stringify({ type: 'PARALLEL', reasoning: 'ok' }) }] }), 50)),
    );
    const result = await negotiateConflict(baseRequest, baseIntent, conflicts);
    expect(result.type).toBe('ESCALATE');
    expect(result.reasoning).toContain('timed out');
    delete process.env.NEGOTIATION_TIMEOUT_MS;
  });

  it('includes participant names and file path in the prompt', async () => {
    mockResponse({ type: 'PARALLEL', reasoning: 'fine' });
    await negotiateConflict(baseRequest, baseIntent, conflicts);
    const promptArg = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(promptArg).toContain('Alice');
    expect(promptArg).toContain('Bob');
    expect(promptArg).toContain('src/auth/middleware.ts');
  });
});
