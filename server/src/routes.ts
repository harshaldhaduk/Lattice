import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Server as SocketServer } from 'socket.io';
import { db } from './db';
import { checkEditConflict } from './conflict';
import { negotiateConflict } from './negotiation';
import {
  CreateSessionRequest,
  JoinSessionRequest,
  RegisterIntentRequest,
  CheckEditRequest,
  ProposePatchRequest,
  Intent,
  Session,
  Participant,
  ShadowPatch,
  SessionState,
} from '@lattice/shared';

export function createRouter(io: SocketServer): Router {
  const router = Router();

  // ── Sessions ────────────────────────────────────────────────────────────────

  router.post('/sessions', (req, res) => {
    const { name, repoUrl }: CreateSessionRequest = req.body;
    const session: Session = {
      id: uuidv4(),
      name,
      repoUrl,
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    db.prepare(`
      INSERT INTO sessions (id, name, repo_url, created_at, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(session.id, session.name, session.repoUrl ?? null, session.createdAt, session.status);

    res.json(session);
  });

  router.post('/sessions/:id/join', (req, res) => {
    const { participantName, agentType }: JoinSessionRequest = req.body;
    const sessionId = req.params.id;

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const participant: Participant = {
      id: uuidv4(),
      sessionId,
      name: participantName,
      agentType,
      status: 'online',
      lastSeen: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO participants (id, session_id, name, agent_type, status, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(participant.id, sessionId, participantName, agentType ?? null, 'online', participant.lastSeen);

    io.to(sessionId).emit('participant:joined', participant);
    res.json(participant);
  });

  router.get('/sessions/:id/state', (req, res) => {
    const sessionId = req.params.id;
    const state = getSessionState(sessionId);
    if (!state) return res.status(404).json({ error: 'Session not found' });
    res.json(state);
  });

  // ── Intents ─────────────────────────────────────────────────────────────────

  router.post('/intents', (req, res) => {
    const body: RegisterIntentRequest = req.body;
    const intent: Intent = {
      id: uuidv4(),
      sessionId: body.sessionId,
      participantId: body.participantId,
      participantName: getParticipantName(body.participantId),
      description: body.description,
      fileScope: body.fileScope,
      functionScope: body.functionScope,
      status: 'in_progress',
      priority: body.priority ?? 'normal',
      createdAt: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO intents
        (id, session_id, participant_id, participant_name, description, file_scope, function_scope, status, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      intent.id, intent.sessionId, intent.participantId, intent.participantName,
      intent.description,
      JSON.stringify(intent.fileScope), JSON.stringify(intent.functionScope),
      intent.status, intent.priority, intent.createdAt
    );

    io.to(body.sessionId).emit('intent:added', intent);
    res.json(intent);
  });

  router.patch('/intents/:id/complete', (req, res) => {
    const completedAt = new Date().toISOString();
    const result = db.prepare(`
      UPDATE intents SET status = 'complete', completed_at = ? WHERE id = ?
    `).run(completedAt, req.params.id);

    if (result.changes === 0) return res.status(404).json({ error: 'Intent not found' });

    const updated = db.prepare('SELECT * FROM intents WHERE id = ?').get(req.params.id) as any;
    const intent = dbRowToIntent(updated);
    io.to(intent.sessionId).emit('intent:updated', intent);
    res.json(intent);
  });

  // ── Edit Checks ─────────────────────────────────────────────────────────────

  router.post('/edits/check', async (req, res) => {
    const body: CheckEditRequest = req.body;
    const verdict = checkEditConflict(body);

    io.to(body.sessionId).emit('conflict:detected', { edit: body, verdict });

    if (verdict.verdict === 'CONFLICT') {
      // Kick off async negotiation — don't block the HTTP response
      const requesterIntentRow = db.prepare('SELECT * FROM intents WHERE id = ?').get(body.intentId) as any;
      if (requesterIntentRow) {
        const requesterIntent = dbRowToIntent(requesterIntentRow);
        negotiateConflict(body, requesterIntent, verdict.conflictingIntents).then(resolution => {
          const now = new Date().toISOString();
          // Store and broadcast each side of the negotiation
          [body.participantId, ...verdict.conflictingIntents.map(i => i.participantId)].forEach(toId => {
            const msgId = uuidv4();
            const msg = {
              id: msgId,
              sessionId: body.sessionId,
              fromParticipantId: 'lattice-orchestrator',
              toParticipantId: toId,
              message: `Resolution (${resolution.type}): ${resolution.reasoning}`,
              messageType: 'resolution' as const,
              createdAt: now,
            };
            db.prepare(`
              INSERT INTO negotiations (id, session_id, from_participant_id, to_participant_id, message, message_type, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(msg.id, msg.sessionId, msg.fromParticipantId, msg.toParticipantId, msg.message, msg.messageType, msg.createdAt);

            io.to(body.sessionId).emit('negotiation:message', msg);
          });
        });
      }
    }

    res.json(verdict);
  });

  // ── Patches ─────────────────────────────────────────────────────────────────

  router.post('/patches', (req, res) => {
    const body: ProposePatchRequest = req.body;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 min TTL

    const patch: ShadowPatch = {
      id: uuidv4(),
      sessionId: body.sessionId,
      intentId: body.intentId,
      proposerId: body.proposerId,
      proposerName: getParticipantName(body.proposerId),
      filePath: body.filePath,
      diff: body.diff,
      reason: body.reason,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    db.prepare(`
      INSERT INTO patches
        (id, session_id, intent_id, proposer_id, proposer_name, file_path, diff, reason, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patch.id, patch.sessionId, patch.intentId, patch.proposerId, patch.proposerName,
      patch.filePath, patch.diff, patch.reason, patch.status, patch.createdAt, patch.expiresAt
    );

    io.to(body.sessionId).emit('patch:pending', patch);
    res.json(patch);
  });

  router.post('/patches/:id/approve', (req, res) => {
    const { reviewerId } = req.body;
    const reviewedAt = new Date().toISOString();

    db.prepare(`
      UPDATE patches SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?
    `).run(reviewerId, reviewedAt, req.params.id);

    const updated = db.prepare('SELECT * FROM patches WHERE id = ?').get(req.params.id) as any;
    const patch = dbRowToPatch(updated);
    io.to(patch.sessionId).emit('patch:updated', patch);
    res.json(patch);
  });

  router.post('/patches/:id/reject', (req, res) => {
    const { reviewerId } = req.body;
    const reviewedAt = new Date().toISOString();

    db.prepare(`
      UPDATE patches SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?
    `).run(reviewerId, reviewedAt, req.params.id);

    const updated = db.prepare('SELECT * FROM patches WHERE id = ?').get(req.params.id) as any;
    const patch = dbRowToPatch(updated);
    io.to(patch.sessionId).emit('patch:updated', patch);
    res.json(patch);
  });

  return router;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getParticipantName(id: string): string {
  const row = db.prepare('SELECT name FROM participants WHERE id = ?').get(id) as any;
  return row?.name ?? 'Unknown';
}

function getSessionState(sessionId: string): SessionState | null {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
  if (!session) return null;

  const participants = (db.prepare('SELECT * FROM participants WHERE session_id = ?').all(sessionId) as any[]).map(r => ({
    id: r.id, sessionId: r.session_id, name: r.name, agentType: r.agent_type,
    status: r.status, currentTask: r.current_task, lastSeen: r.last_seen,
  })) as Participant[];

  const intents = (db.prepare('SELECT * FROM intents WHERE session_id = ?').all(sessionId) as any[]).map(dbRowToIntent);
  const patches = (db.prepare('SELECT * FROM patches WHERE session_id = ?').all(sessionId) as any[]).map(dbRowToPatch);
  const negotiationLog = (db.prepare('SELECT * FROM negotiations WHERE session_id = ?').all(sessionId) as any[]).map(r => ({
    id: r.id, sessionId: r.session_id, fromParticipantId: r.from_participant_id,
    toParticipantId: r.to_participant_id, message: r.message, messageType: r.message_type, createdAt: r.created_at,
  }));

  return {
    session: { id: session.id, name: session.name, repoUrl: session.repo_url, createdAt: session.created_at, status: session.status },
    participants, intents, patches, negotiationLog,
  };
}

function dbRowToIntent(r: any): Intent {
  return {
    id: r.id, sessionId: r.session_id, participantId: r.participant_id,
    participantName: r.participant_name, description: r.description,
    fileScope: JSON.parse(r.file_scope), functionScope: JSON.parse(r.function_scope),
    status: r.status, priority: r.priority, createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
  };
}

function dbRowToPatch(r: any): ShadowPatch {
  return {
    id: r.id, sessionId: r.session_id, intentId: r.intent_id,
    proposerId: r.proposer_id, proposerName: r.proposer_name,
    filePath: r.file_path, diff: r.diff, reason: r.reason,
    status: r.status, createdAt: r.created_at, expiresAt: r.expires_at,
    reviewedBy: r.reviewed_by ?? undefined, reviewedAt: r.reviewed_at ?? undefined,
  };
}
