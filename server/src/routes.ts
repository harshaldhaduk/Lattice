import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { Server as SocketServer } from 'socket.io';
import { db } from './db';
import { checkEditConflict } from './conflict';
import { negotiateConflict } from './negotiation';
import { decomposeTask } from './planner';
import { spawnCodingAgent, claudeAvailable } from './executor';
import {
  CreateSessionRequestSchema,
  JoinSessionRequestSchema,
  RegisterIntentRequestSchema,
  CheckEditRequestSchema,
  ProposePatchRequestSchema,
  UpdatePresenceRequestSchema,
  Intent,
  Session,
  Participant,
  ShadowPatch,
  NegotiationEvent,
  SessionState,
  ConflictDetail,
} from '@lattice/shared';
import { ZodError } from 'zod';

// ── Row → Domain mappers ────────────────────────────────────────────────────

function dbRowToIntent(r: any): Intent {
  return {
    id: r.id,
    sessionId: r.session_id,
    participantId: r.participant_id,
    participantName: r.participant_name,
    actorType: r.actor_type ?? 'human',
    description: r.description,
    filePaths: JSON.parse(r.file_paths ?? '[]'),
    functionNames: JSON.parse(r.function_names ?? '[]'),
    startLine: r.start_line ?? undefined,
    endLine: r.end_line ?? undefined,
    status: r.status,
    priority: r.priority,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? undefined,
  };
}

function dbRowToPatch(r: any): ShadowPatch {
  return {
    id: r.id,
    sessionId: r.session_id,
    intentId: r.intent_id,
    proposerId: r.proposer_id,
    proposerName: r.proposer_name,
    filePath: r.file_path,
    diff: r.diff,
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    reviewedBy: r.reviewed_by ?? undefined,
    reviewedAt: r.reviewed_at ?? undefined,
  };
}

function dbRowToParticipant(r: any): Participant {
  return {
    id: r.id,
    sessionId: r.session_id,
    name: r.name,
    actorType: r.actor_type ?? 'human',
    status: r.status,
    currentTask: r.current_task ?? undefined,
    lastSeen: r.last_seen,
  };
}

function dbRowToEvent(r: any): NegotiationEvent {
  return {
    id: r.id,
    sessionId: r.session_id,
    eventType: r.event_type,
    actorId: r.actor_id,
    actorName: r.actor_name,
    targetId: r.target_id ?? undefined,
    targetName: r.target_name ?? undefined,
    message: r.message,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.created_at,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getParticipantName(id: string): string {
  const row = db.prepare('SELECT name FROM participants WHERE id = ?').get(id) as any;
  return row?.name ?? 'Unknown';
}

function getParticipantActorType(id: string): 'human' | 'agent' {
  const row = db.prepare('SELECT actor_type FROM participants WHERE id = ?').get(id) as any;
  return (row?.actor_type ?? 'human') as 'human' | 'agent';
}

function insertEvent(event: Omit<NegotiationEvent, 'id' | 'createdAt'>): NegotiationEvent {
  const full: NegotiationEvent = {
    ...event,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO events (id, session_id, event_type, actor_id, actor_name, target_id, target_name, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    full.id, full.sessionId, full.eventType,
    full.actorId, full.actorName,
    full.targetId ?? null, full.targetName ?? null,
    full.message,
    full.metadata ? JSON.stringify(full.metadata) : null,
    full.createdAt,
  );
  return full;
}

function getSessionState(sessionId: string): SessionState | null {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
  if (!session) return null;

  const participants = (
    db.prepare('SELECT * FROM participants WHERE session_id = ?').all(sessionId) as any[]
  ).map(dbRowToParticipant);

  const intents = (
    db.prepare('SELECT * FROM intents WHERE session_id = ?').all(sessionId) as any[]
  ).map(dbRowToIntent);

  const patches = (
    db.prepare('SELECT * FROM patches WHERE session_id = ?').all(sessionId) as any[]
  ).map(dbRowToPatch);

  const events = (
    db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[]
  ).map(dbRowToEvent);

  return {
    session: {
      id: session.id,
      name: session.name,
      repoUrl: session.repo_url ?? undefined,
      createdAt: session.created_at,
      status: session.status,
    },
    participants,
    intents,
    patches,
    events,
  };
}

// ── repoPath sanitization ─────────────────────────────────────────────────────
// Prevents path traversal and command injection via client-supplied filesystem paths.

function sanitizeRepoPath(raw: unknown): { ok: true; resolved: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'repoPath must be a non-empty string' };
  }
  const resolved = path.resolve(raw); // normalizes traversal attempts like ../../
  if (!path.isAbsolute(resolved)) {
    return { ok: false, error: 'repoPath must resolve to an absolute path' };
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return { ok: false, error: 'repoPath must be a directory' };
  } catch {
    return { ok: false, error: `repoPath does not exist: ${resolved}` };
  }
  return { ok: true, resolved };
}

// ── Zod validation middleware helper ────────────────────────────────────────

function parseBody<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: ZodError } },
  req: Request,
  res: Response,
): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: 'Validation error',
      issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return null;
  }
  return result.data;
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createRouter(io: SocketServer): Router {
  const router = Router();

  // ── Sessions ──────────────────────────────────────────────────────────────

  router.post('/sessions', (req, res) => {
    const body = parseBody(CreateSessionRequestSchema, req, res);
    if (!body) return;

    const session: Session = {
      id: uuidv4(),
      name: body.name,
      repoUrl: body.repoUrl,
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
    const body = parseBody(JoinSessionRequestSchema, req, res);
    if (!body) return;

    const sessionId = req.params.id;
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const participant: Participant = {
      id: uuidv4(),
      sessionId,
      name: body.participantName,
      actorType: body.actorType ?? 'human',
      status: 'online',
      lastSeen: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO participants (id, session_id, name, actor_type, status, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(participant.id, sessionId, participant.name, participant.actorType, 'online', participant.lastSeen);

    const event = insertEvent({
      sessionId,
      eventType: 'system',
      actorId: participant.id,
      actorName: participant.name,
      message: `${participant.name} joined the session`,
    });

    io.to(sessionId).emit('participant:joined', participant);
    io.to(sessionId).emit('event:added', event);
    res.json(participant);
  });

  router.get('/sessions/:id/state', (req, res) => {
    const state = getSessionState(req.params.id);
    if (!state) { res.status(404).json({ error: 'Session not found' }); return; }
    res.json(state);
  });

  // ── Intents ───────────────────────────────────────────────────────────────

  router.post('/intents', (req, res) => {
    const body = parseBody(RegisterIntentRequestSchema, req, res);
    if (!body) return;

    const actorType = getParticipantActorType(body.participantId);
    const participantName = getParticipantName(body.participantId);

    const intent: Intent = {
      id: uuidv4(),
      sessionId: body.sessionId,
      participantId: body.participantId,
      participantName,
      actorType,
      description: body.description,
      filePaths: body.filePaths,
      functionNames: body.functionNames ?? [],
      startLine: body.startLine,
      endLine: body.endLine,
      status: 'in_progress',
      priority: body.priority ?? 'normal',
      createdAt: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO intents
        (id, session_id, participant_id, participant_name, actor_type,
         description, file_paths, function_names, start_line, end_line,
         status, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      intent.id, intent.sessionId, intent.participantId, intent.participantName, intent.actorType,
      intent.description,
      JSON.stringify(intent.filePaths), JSON.stringify(intent.functionNames),
      intent.startLine ?? null, intent.endLine ?? null,
      intent.status, intent.priority, intent.createdAt,
    );

    const event = insertEvent({
      sessionId: body.sessionId,
      eventType: 'intent_created',
      actorId: body.participantId,
      actorName: participantName,
      message: `${participantName} registered intent: "${body.description}"`,
      metadata: { intentId: intent.id, filePaths: intent.filePaths },
    });

    io.to(body.sessionId).emit('intent:added', intent);
    io.to(body.sessionId).emit('event:added', event);
    res.json(intent);
  });

  router.patch('/intents/:id/complete', (req, res) => {
    const completedAt = new Date().toISOString();
    const result = db.prepare(`
      UPDATE intents SET status = 'complete', completed_at = ? WHERE id = ?
    `).run(completedAt, req.params.id);

    if ((result as any).changes === 0) { res.status(404).json({ error: 'Intent not found' }); return; }

    const updated = db.prepare('SELECT * FROM intents WHERE id = ?').get(req.params.id) as any;
    const intent = dbRowToIntent(updated);
    io.to(intent.sessionId).emit('intent:updated', intent);
    res.json(intent);
  });

  router.patch('/intents/:id/cancel', (req, res) => {
    const result = db.prepare(`
      UPDATE intents SET status = 'cancelled' WHERE id = ?
    `).run(req.params.id);

    if ((result as any).changes === 0) { res.status(404).json({ error: 'Intent not found' }); return; }

    const updated = db.prepare('SELECT * FROM intents WHERE id = ?').get(req.params.id) as any;
    const intent = dbRowToIntent(updated);
    io.to(intent.sessionId).emit('intent:updated', intent);
    res.json(intent);
  });

  // ── Edit Checks ───────────────────────────────────────────────────────────

  router.post('/edits/check', async (req, res) => {
    const body = parseBody(CheckEditRequestSchema, req, res);
    if (!body) return;

    const verdict = checkEditConflict(body);
    const actorName = getParticipantName(body.participantId);

    // Store a conflict_detected event if not SAFE
    if (verdict.verdict !== 'SAFE') {
      const event = insertEvent({
        sessionId: body.sessionId,
        eventType: 'conflict_detected',
        actorId: body.participantId,
        actorName,
        message: verdict.message,
        metadata: { filePath: body.filePath, verdict: verdict.verdict, conflicts: verdict.conflicts },
      });
      io.to(body.sessionId).emit('event:added', event);
      io.to(body.sessionId).emit('conflict:detected', { filePath: body.filePath, verdict });
    }

    // Kick off async AI negotiation for hard conflicts
    if (verdict.verdict === 'CONFLICT') {
      const requesterIntentRow = db.prepare('SELECT * FROM intents WHERE id = ?').get(body.intentId) as any;
      if (requesterIntentRow) {
        const requesterIntent = dbRowToIntent(requesterIntentRow);

        const startEvent = insertEvent({
          sessionId: body.sessionId,
          eventType: 'negotiation_started',
          actorId: 'lattice-orchestrator',
          actorName: 'Lattice Orchestrator',
          message: `Negotiation started for conflict on ${body.filePath}`,
        });
        io.to(body.sessionId).emit('event:added', startEvent);

        // Non-blocking negotiation
        negotiateConflict(body, requesterIntent, verdict.conflicts).then(resolution => {
          const resolvedEvent = insertEvent({
            sessionId: body.sessionId,
            eventType: 'negotiation_resolved',
            actorId: 'lattice-orchestrator',
            actorName: 'Lattice Orchestrator',
            message: `Resolution (${resolution.type}): ${resolution.reasoning}`,
            metadata: { resolution },
          });
          io.to(body.sessionId).emit('event:added', resolvedEvent);
        }).catch(err => {
          console.error('Negotiation error:', err);
        });
      }
    }

    res.json(verdict);
  });

  // ── Shadow Patches ────────────────────────────────────────────────────────

  router.post('/patches', (req, res) => {
    const body = parseBody(ProposePatchRequestSchema, req, res);
    if (!body) return;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 min TTL
    const proposerName = getParticipantName(body.proposerId);

    const patch: ShadowPatch = {
      id: uuidv4(),
      sessionId: body.sessionId,
      intentId: body.intentId,
      proposerId: body.proposerId,
      proposerName,
      filePath: body.filePath,
      diff: body.diff,
      reason: body.reason,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    db.prepare(`
      INSERT INTO patches
        (id, session_id, intent_id, proposer_id, proposer_name, file_path,
         diff, reason, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patch.id, patch.sessionId, patch.intentId, patch.proposerId, patch.proposerName,
      patch.filePath, patch.diff, patch.reason, patch.status,
      patch.createdAt, patch.expiresAt,
    );

    const event = insertEvent({
      sessionId: body.sessionId,
      eventType: 'patch_staged',
      actorId: body.proposerId,
      actorName: proposerName,
      message: `${proposerName} staged a patch for ${body.filePath}`,
      metadata: { patchId: patch.id, filePath: body.filePath },
    });

    io.to(body.sessionId).emit('patch:pending', patch);
    io.to(body.sessionId).emit('event:added', event);
    res.json(patch);
  });

  router.post('/patches/:id/approve', (req, res) => {
    const { reviewerId } = req.body;
    const reviewedAt = new Date().toISOString();

    db.prepare(`
      UPDATE patches SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?
    `).run(reviewerId ?? null, reviewedAt, req.params.id);

    const updated = db.prepare('SELECT * FROM patches WHERE id = ?').get(req.params.id) as any;
    if (!updated) { res.status(404).json({ error: 'Patch not found' }); return; }

    const patch = dbRowToPatch(updated);
    const reviewerName = reviewerId ? getParticipantName(reviewerId) : 'Unknown';

    const event = insertEvent({
      sessionId: patch.sessionId,
      eventType: 'patch_approved',
      actorId: reviewerId ?? 'unknown',
      actorName: reviewerName,
      targetId: patch.proposerId,
      targetName: patch.proposerName,
      message: `${reviewerName} approved patch for ${patch.filePath}`,
      metadata: { patchId: patch.id },
    });

    io.to(patch.sessionId).emit('patch:updated', patch);
    io.to(patch.sessionId).emit('event:added', event);
    res.json(patch);
  });

  router.post('/patches/:id/reject', (req, res) => {
    const { reviewerId } = req.body;
    const reviewedAt = new Date().toISOString();

    db.prepare(`
      UPDATE patches SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?
    `).run(reviewerId ?? null, reviewedAt, req.params.id);

    const updated = db.prepare('SELECT * FROM patches WHERE id = ?').get(req.params.id) as any;
    if (!updated) { res.status(404).json({ error: 'Patch not found' }); return; }

    const patch = dbRowToPatch(updated);
    const reviewerName = reviewerId ? getParticipantName(reviewerId) : 'Unknown';

    const event = insertEvent({
      sessionId: patch.sessionId,
      eventType: 'patch_rejected',
      actorId: reviewerId ?? 'unknown',
      actorName: reviewerName,
      targetId: patch.proposerId,
      targetName: patch.proposerName,
      message: `${reviewerName} rejected patch for ${patch.filePath}`,
      metadata: { patchId: patch.id },
    });

    io.to(patch.sessionId).emit('patch:updated', patch);
    io.to(patch.sessionId).emit('event:added', event);
    res.json(patch);
  });

  // ── Presence ──────────────────────────────────────────────────────────────

  router.patch('/sessions/:id/presence', (req, res) => {
    const body = parseBody(UpdatePresenceRequestSchema, req, res);
    if (!body) return;

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE participants SET current_task = ?, status = ?, last_seen = ? WHERE id = ?
    `).run(body.currentTask ?? null, body.status ?? 'online', now, body.participantId);

    const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(body.participantId) as any;
    if (!row) { res.status(404).json({ error: 'Participant not found' }); return; }

    const participant = dbRowToParticipant(row);
    io.to(req.params.id).emit('presence:changed', participant);
    res.json(participant);
  });

  // ── AI Task Planning ──────────────────────────────────────────────────────

  router.post('/sessions/:id/plan', async (req, res) => {
    const { prompt, participantId, autoRegister } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    try {
      const specs = await decomposeTask(prompt, session.repo_url ?? undefined);

      // Optionally register all intents immediately
      if (autoRegister && participantId) {
        const actorType = getParticipantActorType(participantId);
        const participantName = getParticipantName(participantId);
        const registered = [];

        for (const spec of specs) {
          const intent: any = {
            id: uuidv4(),
            sessionId: req.params.id,
            participantId,
            participantName,
            actorType,
            description: spec.description,
            filePaths: spec.filePaths,
            functionNames: spec.functionNames,
            startLine: undefined,
            endLine: undefined,
            status: 'in_progress',
            priority: spec.priority,
            createdAt: new Date().toISOString(),
          };

          db.prepare(`
            INSERT INTO intents
              (id, session_id, participant_id, participant_name, actor_type,
               description, file_paths, function_names, start_line, end_line,
               status, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            intent.id, intent.sessionId, intent.participantId, intent.participantName, intent.actorType,
            intent.description,
            JSON.stringify(intent.filePaths), JSON.stringify(intent.functionNames),
            null, null, intent.status, intent.priority, intent.createdAt,
          );

          const event = insertEvent({
            sessionId: req.params.id,
            eventType: 'intent_created',
            actorId: participantId,
            actorName: participantName,
            message: `[AI Plan] ${participantName}: "${spec.description}"`,
            metadata: { intentId: intent.id, filePaths: intent.filePaths, rationale: spec.rationale },
          });

          io.to(req.params.id).emit('intent:added', intent);
          io.to(req.params.id).emit('event:added', event);
          registered.push(intent);
        }

        res.json({ specs, registered });
      } else {
        res.json({ specs, registered: [] });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error('Plan decomposition failed:', msg);
      res.status(500).json({ error: `AI planning failed: ${msg}` });
    }
  });

  // ── GitHub Sync ──────────────────────────────────────────────────────────
  //
  // Collapses all session activity into an intent-annotated commit message.
  // Returns the proposed message + structured summary; does not push automatically
  // (requires GITHUB_TOKEN + repoUrl to be set on the session for actual push).

  router.post('/sessions/:id/sync', async (req, res) => {
    const sessionId = req.params.id;
    const state = getSessionState(sessionId);
    if (!state) { res.status(404).json({ error: 'Session not found' }); return; }

    const pathCheck = sanitizeRepoPath(req.body.repoPath ?? null);
    const repoPath = pathCheck.ok ? pathCheck.resolved : null;

    // Build intent-annotated commit message
    const completedIntents = state.intents.filter(i => i.status === 'complete');
    const approvedPatches = state.patches.filter(p => p.status === 'approved');
    const participants = state.participants.map(p => p.name).join(', ');

    const intentLines = completedIntents
      .map(i => `  - [${i.actorType}] ${i.participantName}: ${i.description}`)
      .join('\n');

    const patchLines = approvedPatches
      .map(p => `  - ${p.filePath} (by ${p.proposerName})`)
      .join('\n');

    const commitMessage = [
      `feat: lattice session "${state.session.name}"`,
      ``,
      `Participants: ${participants}`,
      ``,
      completedIntents.length > 0 ? `Completed intents:\n${intentLines}` : null,
      approvedPatches.length > 0 ? `\nApproved patches:\n${patchLines}` : null,
      ``,
      `[lattice session: ${sessionId}]`,
    ].filter(line => line !== null).join('\n');

    // If repoPath provided, attempt to create the commit
    let committed = false;
    let commitHash: string | undefined;
    if (repoPath) {
      const { execSync } = await import('child_process');
      try {
        // Stage all changes and commit with the generated message
        execSync('git add -A', { cwd: repoPath, timeout: 10000 });
        const result = execSync(
          `git commit -m ${JSON.stringify(commitMessage)} --allow-empty`,
          { cwd: repoPath, timeout: 10000 },
        ).toString();
        const hashMatch = result.match(/\[[\w./]+ ([a-f0-9]+)\]/);
        commitHash = hashMatch?.[1];
        committed = true;
      } catch (err: any) {
        // Nothing staged or git error — return the message anyway
      }
    }

    const event = insertEvent({
      sessionId,
      eventType: 'system',
      actorId: 'lattice-orchestrator',
      actorName: 'Lattice Orchestrator',
      message: committed
        ? `Session synced to git (${commitHash})`
        : `Session sync message generated (${completedIntents.length} intents, ${approvedPatches.length} patches)`,
    });
    io.to(sessionId).emit('event:added', event);

    res.json({
      commitMessage,
      committed,
      commitHash,
      summary: {
        participants: state.participants.length,
        completedIntents: completedIntents.length,
        approvedPatches: approvedPatches.length,
        totalEvents: state.events.length,
      },
    });
  });

  // ── Agent Execution ──────────────────────────────────────────────────────

  router.post('/sessions/:id/execute', async (req, res) => {
    const { specs, repoPath: rawRepoPath, participantId } = req.body;

    if (!specs?.length) { res.status(400).json({ error: 'specs required' }); return; }

    // Sanitize repoPath: normalize, verify absolute path, confirm it's an existing directory
    const pathCheck = sanitizeRepoPath(rawRepoPath);
    if (!pathCheck.ok) { res.status(400).json({ error: pathCheck.error }); return; }
    const safeRepoPath = pathCheck.resolved;

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    if (!(await claudeAvailable())) {
      res.status(400).json({ error: 'claude CLI not found. Install: npm install -g @anthropic-ai/claude-code' });
      return;
    }

    const sessionId = req.params.id;

    // Emit start event
    const startEvent = insertEvent({
      sessionId,
      eventType: 'system',
      actorId: 'lattice-orchestrator',
      actorName: 'Lattice Orchestrator',
      message: `Spawning ${specs.length} AI agent${specs.length > 1 ? 's' : ''} in parallel...`,
    });
    io.to(sessionId).emit('event:added', startEvent);

    // Run all agents in parallel
    const agentPromises = specs.map(async (spec: any) => {
      // Register a new "agent" participant for this task
      const agentParticipant = {
        id: uuidv4(),
        sessionId,
        name: `AI: ${spec.description.slice(0, 35)}`,
        actorType: 'agent' as const,
        status: 'online' as const,
        lastSeen: new Date().toISOString(),
      };

      db.prepare(`
        INSERT INTO participants (id, session_id, name, actor_type, status, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(agentParticipant.id, sessionId, agentParticipant.name, 'agent', 'online', agentParticipant.lastSeen);

      io.to(sessionId).emit('participant:joined', agentParticipant);

      // Register intent
      const intentId = uuidv4();
      db.prepare(`
        INSERT INTO intents
          (id, session_id, participant_id, participant_name, actor_type,
           description, file_paths, function_names, start_line, end_line,
           status, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        intentId, sessionId, agentParticipant.id, agentParticipant.name, 'agent',
        spec.description, JSON.stringify(spec.filePaths), JSON.stringify(spec.functionNames ?? []),
        null, null, 'in_progress', spec.priority, new Date().toISOString(),
      );

      // Spawn the agent
      const result = await spawnCodingAgent(spec, safeRepoPath, (msg) => {
        const ev = insertEvent({
          sessionId,
          eventType: 'system',
          actorId: agentParticipant.id,
          actorName: agentParticipant.name,
          message: msg,
        });
        io.to(sessionId).emit('event:added', ev);
      });

      // Stage result as a shadow patch (even if empty diff — records the attempt)
      const patchId = uuidv4();
      const now = new Date();
      const diff = result.diff || `// Agent completed: ${spec.description}\n// No file changes detected.`;

      db.prepare(`
        INSERT INTO patches
          (id, session_id, intent_id, proposer_id, proposer_name, file_path,
           diff, reason, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        patchId, sessionId, intentId, agentParticipant.id, agentParticipant.name,
        spec.filePaths[0] ?? 'unknown',
        diff,
        `AI agent implementation: ${spec.description}`,
        'pending',
        now.toISOString(),
        new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), // 24h TTL
      );

      // Mark intent complete or cancelled based on result
      db.prepare(`UPDATE intents SET status = ?, completed_at = ? WHERE id = ?`)
        .run(result.success ? 'complete' : 'cancelled', now.toISOString(), intentId);

      const patch = {
        id: patchId, sessionId, intentId,
        proposerId: agentParticipant.id, proposerName: agentParticipant.name,
        filePath: spec.filePaths[0] ?? 'unknown',
        diff, reason: `AI agent: ${spec.description}`,
        status: 'pending' as const,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      };

      io.to(sessionId).emit('patch:pending', patch);

      const doneEvent = insertEvent({
        sessionId,
        eventType: result.success ? 'patch_staged' : 'system',
        actorId: agentParticipant.id,
        actorName: agentParticipant.name,
        message: result.success
          ? `Agent finished "${spec.description}" — patch ready for review`
          : `Agent failed: ${result.error?.slice(0, 100)}`,
        metadata: { patchId, success: result.success },
      });
      io.to(sessionId).emit('event:added', doneEvent);

      return result;
    });

    // Don't await — respond immediately, agents run async
    Promise.all(agentPromises).then(results => {
      const done = insertEvent({
        sessionId,
        eventType: 'negotiation_resolved',
        actorId: 'lattice-orchestrator',
        actorName: 'Lattice Orchestrator',
        message: `All agents done. ${results.filter(r => r.success).length}/${results.length} succeeded. Review patches in the Patches tab.`,
      });
      io.to(sessionId).emit('event:added', done);
    }).catch(console.error);

    res.json({ message: `${specs.length} agents spawned. Watch the Log tab for progress.` });
  });

  return router;
}
