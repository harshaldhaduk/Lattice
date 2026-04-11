import { CheckEditRequest, CheckEditResponse, ConflictDetail } from '@lattice/shared';
import { db } from './db';

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

function rangesOverlap(
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

  // Tier 2: Function-name overlap (strongest signal — return CONFLICT immediately)
  if (req.functionNames && req.functionNames.length > 0) {
    const fnMatches = fileMatches.filter(r => {
      const fns: string[] = JSON.parse(r.function_names);
      return fns.some(fn => req.functionNames!.includes(fn));
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
