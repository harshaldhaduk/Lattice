import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the db module before importing conflict ──────────────────────────────
const mockAll = vi.fn(() => [] as unknown[]);
const mockPrepare = vi.fn(() => ({ all: mockAll }));

vi.mock('../db', () => ({
  db: { prepare: mockPrepare },
}));

import {
  rangesOverlap,
  checkEditConflict,
  extractFunctionsFromSource,
  inferFunctionNamesFromRange,
} from '../conflict';

// ── rangesOverlap ─────────────────────────────────────────────────────────────

describe('rangesOverlap', () => {
  it('returns false when either range has null bounds', () => {
    expect(rangesOverlap(null, 10, 5, 15)).toBe(false);
    expect(rangesOverlap(1, null, 5, 15)).toBe(false);
    expect(rangesOverlap(1, 10, null, 15)).toBe(false);
    expect(rangesOverlap(1, 10, 5, null)).toBe(false);
  });

  it('detects full overlap', () => {
    expect(rangesOverlap(1, 20, 5, 15)).toBe(true);
  });

  it('detects partial overlap', () => {
    expect(rangesOverlap(1, 10, 8, 20)).toBe(true);
  });

  it('detects adjacent ranges as overlapping (inclusive)', () => {
    expect(rangesOverlap(1, 10, 10, 20)).toBe(true);
  });

  it('returns false for non-overlapping ranges', () => {
    expect(rangesOverlap(1, 5, 10, 20)).toBe(false);
    expect(rangesOverlap(10, 20, 1, 5)).toBe(false);
  });

  it('handles single-line ranges', () => {
    expect(rangesOverlap(5, 5, 5, 5)).toBe(true);
    expect(rangesOverlap(5, 5, 6, 6)).toBe(false);
  });
});

// ── extractFunctionsFromSource ────────────────────────────────────────────────

describe('extractFunctionsFromSource', () => {
  it('extracts named function declarations', () => {
    const src = `
function calculateTotal(items) {
  return items.reduce((sum, i) => sum + i, 0);
}
`;
    const fns = extractFunctionsFromSource(src, 'utils.ts');
    expect(fns.some(f => f.name === 'calculateTotal')).toBe(true);
  });

  it('extracts arrow function variables', () => {
    const src = `
const fetchUser = async (id) => {
  return await db.findById(id);
};
`;
    const fns = extractFunctionsFromSource(src, 'service.ts');
    expect(fns.some(f => f.name === 'fetchUser')).toBe(true);
  });

  it('extracts class methods', () => {
    const src = `
class UserService {
  async createUser(data) {
    return this.repo.create(data);
  }
  deleteUser(id) {
    return this.repo.delete(id);
  }
}
`;
    const fns = extractFunctionsFromSource(src, 'service.ts');
    const names = fns.map(f => f.name);
    expect(names).toContain('createUser');
    expect(names).toContain('deleteUser');
  });

  it('returns correct line boundaries', () => {
    const src = `function foo() {\n  return 1;\n}\n`;
    const fns = extractFunctionsFromSource(src, 'foo.ts');
    const foo = fns.find(f => f.name === 'foo');
    expect(foo).toBeDefined();
    expect(foo!.startLine).toBe(1);
    expect(foo!.endLine).toBe(3);
  });

  it('returns empty array for unparseable content', () => {
    const fns = extractFunctionsFromSource('this is not code !@#$', 'bad.ts');
    expect(fns).toEqual([]);
  });

  it('handles TypeScript syntax without throwing', () => {
    const src = `
interface User { id: string; name: string; }
export function greet(user: User): string {
  return \`Hello \${user.name}\`;
}
`;
    const fns = extractFunctionsFromSource(src, 'greet.ts');
    expect(fns.some(f => f.name === 'greet')).toBe(true);
  });
});

// ── inferFunctionNamesFromRange ───────────────────────────────────────────────

describe('inferFunctionNamesFromRange', () => {
  const src = [
    'function alpha() {', // line 1
    '  return 1;',         // line 2
    '}',                   // line 3
    'function beta() {',   // line 4
    '  return 2;',         // line 5
    '}',                   // line 6
  ].join('\n');

  it('returns function name when range overlaps with it', () => {
    const names = inferFunctionNamesFromRange(src, 'f.ts', 1, 3);
    expect(names).toContain('alpha');
  });

  it('returns correct function when range targets second function', () => {
    const names = inferFunctionNamesFromRange(src, 'f.ts', 4, 6);
    expect(names).toContain('beta');
    expect(names).not.toContain('alpha');
  });

  it('returns empty array when range is outside all functions', () => {
    const names = inferFunctionNamesFromRange(src, 'f.ts', 10, 20);
    expect(names).toEqual([]);
  });
});

// ── checkEditConflict ─────────────────────────────────────────────────────────

describe('checkEditConflict', () => {
  const SESSION_ID = '00000000-0000-0000-0000-000000000001';
  const MY_PARTICIPANT = '00000000-0000-0000-0000-000000000002';
  const OTHER_PARTICIPANT = '00000000-0000-0000-0000-000000000003';
  const INTENT_ID = '00000000-0000-0000-0000-000000000004';

  const baseReq = {
    sessionId: SESSION_ID,
    participantId: MY_PARTICIPANT,
    intentId: INTENT_ID,
    filePath: 'src/auth.ts',
    diff: '',
    functionNames: [],
  };

  const makeIntent = (overrides: Partial<{
    file_paths: string;
    function_names: string;
    start_line: number | null;
    end_line: number | null;
  }> = {}) => ({
    id: INTENT_ID,
    session_id: SESSION_ID,
    participant_id: OTHER_PARTICIPANT,
    participant_name: 'Alice',
    actor_type: 'human',
    description: 'Refactor auth',
    file_paths: '["src/auth.ts"]',
    function_names: '[]',
    start_line: null,
    end_line: null,
    status: 'in_progress',
    priority: 'normal',
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  });

  beforeEach(() => {
    mockAll.mockReset();
    mockPrepare.mockReturnValue({ all: mockAll });
  });

  it('returns SAFE when no other active intents exist', () => {
    mockAll.mockReturnValue([]);
    const result = checkEditConflict(baseReq);
    expect(result.verdict).toBe('SAFE');
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns SAFE when other intents do not claim the same file', () => {
    mockAll.mockReturnValue([makeIntent({ file_paths: '["src/other.ts"]' })]);
    const result = checkEditConflict(baseReq);
    expect(result.verdict).toBe('SAFE');
  });

  it('returns REVIEW when file is claimed but no function/line overlap', () => {
    mockAll.mockReturnValue([makeIntent()]);
    const result = checkEditConflict(baseReq);
    expect(result.verdict).toBe('REVIEW');
    expect(result.conflicts[0].overlapType).toBe('file');
  });

  it('returns CONFLICT on function-name overlap', () => {
    mockAll.mockReturnValue([makeIntent({ function_names: '["verifyToken"]' })]);
    const result = checkEditConflict({
      ...baseReq,
      functionNames: ['verifyToken'],
    });
    expect(result.verdict).toBe('CONFLICT');
    expect(result.conflicts[0].overlapType).toBe('function');
  });

  it('returns CONFLICT on line-range overlap', () => {
    mockAll.mockReturnValue([makeIntent({ start_line: 10, end_line: 30 })]);
    const result = checkEditConflict({
      ...baseReq,
      startLine: 20,
      endLine: 40,
    });
    expect(result.verdict).toBe('CONFLICT');
    expect(result.conflicts[0].overlapType).toBe('line_range');
  });

  it('returns SAFE on adjacent but non-overlapping line ranges', () => {
    mockAll.mockReturnValue([makeIntent({ start_line: 1, end_line: 9 })]);
    const result = checkEditConflict({
      ...baseReq,
      startLine: 10,
      endLine: 20,
    });
    // Line 9 and line 10 are adjacent — rangesOverlap is inclusive so 9<=10 && 10<=9 is false
    expect(result.verdict).toBe('REVIEW'); // file claimed, but no line overlap
  });

  it('uses AST to infer function names when fileContent is provided', () => {
    const src = [
      'function verifyToken(tok) {', // lines 1-3
      '  return tok === "valid";',
      '}',
    ].join('\n');

    mockAll.mockReturnValue([makeIntent({ function_names: '["verifyToken"]' })]);

    const result = checkEditConflict({
      ...baseReq,
      // No explicit functionNames, but fileContent + line range provided
      functionNames: [],
      startLine: 1,
      endLine: 3,
      fileContent: src,
    });

    // Should infer 'verifyToken' from AST and detect conflict
    expect(result.verdict).toBe('CONFLICT');
    expect(result.conflicts[0].overlapType).toBe('function');
  });
});
