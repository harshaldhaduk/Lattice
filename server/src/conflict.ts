import { Intent, CheckEditRequest, CheckEditResponse, ConflictVerdict } from '@lattice/shared';
import { db } from './db';

interface DbIntent {
  id: string;
  session_id: string;
  participant_id: string;
  participant_name: string;
  description: string;
  file_scope: string;
  function_scope: string;
  status: string;
  priority: string;
  created_at: string;
  completed_at: string | null;
}

function dbRowToIntent(row: DbIntent): Intent {
  return {
    id: row.id,
    sessionId: row.session_id,
    participantId: row.participant_id,
    participantName: row.participant_name,
    description: row.description,
    fileScope: JSON.parse(row.file_scope),
    functionScope: JSON.parse(row.function_scope),
    status: row.status as Intent['status'],
    priority: row.priority as Intent['priority'],
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function checkEditConflict(req: CheckEditRequest): CheckEditResponse {
  // Fetch all active intents in this session that belong to OTHER participants
  const rows = db.prepare(`
    SELECT * FROM intents
    WHERE session_id = ?
      AND participant_id != ?
      AND status = 'in_progress'
  `).all(req.sessionId, req.participantId) as unknown as DbIntent[];

  const activeIntents = rows.map(dbRowToIntent);

  if (activeIntents.length === 0) {
    return { verdict: 'SAFE', conflictingIntents: [], message: 'No active intents. Safe to apply.' };
  }

  // Tier 1: File-level overlap
  const fileConflicts = activeIntents.filter(i => i.fileScope.includes(req.filePath));

  if (fileConflicts.length === 0) {
    return { verdict: 'SAFE', conflictingIntents: [], message: 'File not claimed by any active intent.' };
  }

  // Tier 2: Function-level overlap (if modifiedFunctions provided)
  if (req.modifiedFunctions && req.modifiedFunctions.length > 0) {
    const functionConflicts = fileConflicts.filter(i =>
      i.functionScope.some(fn => req.modifiedFunctions!.includes(fn))
    );

    if (functionConflicts.length > 0) {
      const names = functionConflicts.map(i => i.participantName).join(', ');
      return {
        verdict: 'CONFLICT',
        conflictingIntents: functionConflicts,
        message: `Function-level conflict with ${names}. Negotiation required.`,
      };
    }
  }

  // File claimed but no function-level hit → REVIEW
  const names = fileConflicts.map(i => i.participantName).join(', ');
  return {
    verdict: 'REVIEW',
    conflictingIntents: fileConflicts,
    message: `${req.filePath} is in ${names}'s scope. Staging as shadow patch recommended.`,
  };
}
