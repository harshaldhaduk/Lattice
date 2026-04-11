import { parse } from '@babel/parser';
import { CheckEditRequest, CheckEditResponse, ConflictDetail } from '@lattice/shared';
import { db } from './db';

// ── AST helpers ───────────────────────────────────────────────────────────────

export interface FunctionBoundary {
  name: string;
  startLine: number;
  endLine: number;
}

/**
 * Parse JS/TS source and return every function's name + line boundaries.
 * Used to auto-detect which function a change falls inside when
 * the caller doesn't supply explicit functionNames.
 */
export function extractFunctionsFromSource(
  source: string,
  filePath: string,
): FunctionBoundary[] {
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  const isJSX = filePath.endsWith('.jsx') || filePath.endsWith('.tsx');

  try {
    const ast = parse(source, {
      sourceType: 'module',
      strictMode: false,
      plugins: [
        ...(isTS ? (['typescript'] as const) : []),
        ...(isJSX ? (['jsx'] as const) : []),
        'decorators-legacy',
        'classProperties',
        'optionalChaining',
        'nullishCoalescingOperator',
      ],
    });

    const functions: FunctionBoundary[] = [];

    function getName(node: any): string | null {
      switch (node.type) {
        case 'FunctionDeclaration':
          return node.id?.name ?? null;
        case 'FunctionExpression':
          return node.id?.name ?? null;
        case 'ArrowFunctionExpression':
          return null; // handled via parent VariableDeclarator
        case 'ClassMethod':
        case 'ObjectMethod':
          return node.key?.name ?? node.key?.value ?? null;
        case 'VariableDeclarator':
          if (
            node.init &&
            (node.init.type === 'ArrowFunctionExpression' ||
              node.init.type === 'FunctionExpression')
          ) {
            return node.id?.name ?? null;
          }
          return null;
        default:
          return null;
      }
    }

    function visit(node: any): void {
      if (!node || typeof node !== 'object') return;
      if (!node.type) return;

      const name = getName(node);
      if (name && node.loc) {
        functions.push({
          name,
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
        });
      }

      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
        const child: unknown = (node as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          child.forEach(visit);
        } else if (child && typeof child === 'object' && (child as any).type) {
          visit(child);
        }
      }
    }

    visit(ast.program);
    return functions;
  } catch {
    // Silently fall back — not all files are parseable (e.g., non-JS/TS)
    return [];
  }
}

/**
 * Given file content and a line range, return the names of all functions
 * whose body overlaps [startLine, endLine].
 */
export function inferFunctionNamesFromRange(
  source: string,
  filePath: string,
  startLine: number,
  endLine: number,
): string[] {
  const boundaries = extractFunctionsFromSource(source, filePath);
  return boundaries
    .filter(fn => rangesOverlap(fn.startLine, fn.endLine, startLine, endLine))
    .map(fn => fn.name);
}

// ── Conflict detection ────────────────────────────────────────────────────────

interface DbIntent {
  id: string;
  session_id: string;
  participant_id: string;
  participant_name: string;
  actor_type: string;
  description: string;
  file_paths: string;   // JSON array
  function_names: string; // JSON array
  start_line: number | null;
  end_line: number | null;
  status: string;
  priority: string;
  created_at: string;
  completed_at: string | null;
}

export function rangesOverlap(
  aStart: number | null | undefined,
  aEnd: number | null | undefined,
  bStart: number | null | undefined,
  bEnd: number | null | undefined,
): boolean {
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

export function checkEditConflict(req: CheckEditRequest): CheckEditResponse {
  // All active intents in this session owned by OTHER participants
  const rows = db.prepare(`
    SELECT * FROM intents
    WHERE session_id = ?
      AND participant_id != ?
      AND status = 'in_progress'
  `).all(req.sessionId, req.participantId) as unknown as DbIntent[];

  if (rows.length === 0) {
    return { verdict: 'SAFE', conflicts: [], message: 'No active intents. Safe to apply.' };
  }

  // Tier 1: File-level scope
  const fileMatches = rows.filter(r => {
    const paths: string[] = JSON.parse(r.file_paths);
    return paths.includes(req.filePath);
  });

  if (fileMatches.length === 0) {
    return { verdict: 'SAFE', conflicts: [], message: 'File not claimed by any active intent.' };
  }

  // Enhance functionNames via AST if caller provided file content
  let effectiveFunctionNames = req.functionNames ?? [];
  if (
    req.fileContent &&
    effectiveFunctionNames.length === 0 &&
    req.startLine != null &&
    req.endLine != null
  ) {
    const inferred = inferFunctionNamesFromRange(
      req.fileContent,
      req.filePath,
      req.startLine,
      req.endLine,
    );
    if (inferred.length > 0) {
      effectiveFunctionNames = inferred;
    }
  }

  // Tier 2: Function-name overlap (strongest signal — return CONFLICT immediately)
  if (effectiveFunctionNames.length > 0) {
    const fnMatches = fileMatches.filter(r => {
      const fns: string[] = JSON.parse(r.function_names);
      return fns.some(fn => effectiveFunctionNames.includes(fn));
    });

    if (fnMatches.length > 0) {
      const details: ConflictDetail[] = fnMatches.map(r => ({
        intentId: r.id,
        participantName: r.participant_name,
        actorType: r.actor_type as 'human' | 'agent',
        description: r.description,
        filePath: req.filePath,
        functionNames: JSON.parse(r.function_names),
        overlapType: 'function' as const,
      }));
      const names = fnMatches.map(r => r.participant_name).join(', ');
      return {
        verdict: 'CONFLICT',
        conflicts: details,
        message: `Function-level conflict with ${names}. Negotiation required.`,
      };
    }
  }

  // Tier 3: Line-range overlap
  if (req.startLine != null && req.endLine != null) {
    const lineMatches = fileMatches.filter(r =>
      rangesOverlap(req.startLine, req.endLine, r.start_line, r.end_line)
    );

    if (lineMatches.length > 0) {
      const details: ConflictDetail[] = lineMatches.map(r => ({
        intentId: r.id,
        participantName: r.participant_name,
        actorType: r.actor_type as 'human' | 'agent',
        description: r.description,
        filePath: req.filePath,
        functionNames: JSON.parse(r.function_names),
        overlapType: 'line_range' as const,
      }));
      const names = lineMatches.map(r => r.participant_name).join(', ');
      return {
        verdict: 'CONFLICT',
        conflicts: details,
        message: `Line-range overlap (${req.startLine}-${req.endLine}) with ${names}. Negotiation required.`,
      };
    }
  }

  // File claimed but no function/line overlap → REVIEW (shadow patch recommended)
  const details: ConflictDetail[] = fileMatches.map(r => ({
    intentId: r.id,
    participantName: r.participant_name,
    actorType: r.actor_type as 'human' | 'agent',
    description: r.description,
    filePath: req.filePath,
    functionNames: JSON.parse(r.function_names),
    overlapType: 'file' as const,
  }));
  const names = fileMatches.map(r => r.participant_name).join(', ');
  return {
    verdict: 'REVIEW',
    conflicts: details,
    message: `${req.filePath} is in ${names}'s scope. Staging as shadow patch is recommended.`,
  };
}
