/**
 * Integration tests for Lattice API routes.
 *
 * Uses an in-memory SQLite database (LATTICE_DB_PATH=:memory:) so each
 * test suite starts with a clean state.  The Socket.io instance is a
 * lightweight stub — we only care that events are emitted without error.
 */

// Must be set BEFORE any module is imported so db.ts picks it up
process.env.LATTICE_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Application } from 'express';
import { initDb, db } from '../db';
import { createRouter } from '../routes';

// ── Stub Socket.io ────────────────────────────────────────────────────────────

function makeStubIo() {
  return {
    to: () => ({ emit: () => {} }),
  } as any;
}

// ── Test app factory ──────────────────────────────────────────────────────────

function buildApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/api', createRouter(makeStubIo()));
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createSession(app: Application, name = 'Test Session') {
  const res = await request(app)
    .post('/api/sessions')
    .send({ name });
  expect(res.status).toBe(200);
  return res.body as { id: string; name: string; status: string };
}

async function joinSession(app: Application, sessionId: string, participantName = 'Alice') {
  const res = await request(app)
    .post(`/api/sessions/${sessionId}/join`)
    .send({ participantName, actorType: 'human' });
  expect(res.status).toBe(200);
  return res.body as { id: string; name: string; actorType: string };
}

async function registerIntent(
  app: Application,
  sessionId: string,
  participantId: string,
  opts: { filePaths?: string[]; functionNames?: string[] } = {},
) {
  const res = await request(app)
    .post('/api/intents')
    .send({
      sessionId,
      participantId,
      description: 'Refactor verifyToken',
      filePaths: opts.filePaths ?? ['src/auth/middleware.ts'],
      functionNames: opts.functionNames ?? ['verifyToken'],
      priority: 'normal',
    });
  expect(res.status).toBe(200);
  return res.body as { id: string };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

let app: Application;

beforeAll(() => {
  initDb();
  app = buildApp();
});

// Clear all tables between tests so state doesn't bleed across suites
beforeEach(() => {
  db.exec('DELETE FROM events; DELETE FROM patches; DELETE FROM intents; DELETE FROM participants; DELETE FROM sessions;');
});

afterAll(() => {
  // nothing — in-memory db cleaned up automatically
});

// ── Session lifecycle ─────────────────────────────────────────────────────────

describe('POST /api/sessions', () => {
  it('creates a session and returns it', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ name: 'Hackathon Sprint' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Hackathon Sprint');
    expect(res.body.status).toBe('active');
    expect(res.body.id).toBeTruthy();
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/sessions').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.issues).toBeDefined();
  });

  it('returns 400 for empty name', async () => {
    const res = await request(app).post('/api/sessions').send({ name: '' });
    expect(res.status).toBe(400);
  });
});

// ── Participant join ──────────────────────────────────────────────────────────

describe('POST /api/sessions/:id/join', () => {
  it('allows a human to join', async () => {
    const session = await createSession(app);
    const res = await request(app)
      .post(`/api/sessions/${session.id}/join`)
      .send({ participantName: 'Bob', actorType: 'human' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bob');
    expect(res.body.actorType).toBe('human');
    expect(res.body.status).toBe('online');
  });

  it('allows an agent to join', async () => {
    const session = await createSession(app);
    const res = await request(app)
      .post(`/api/sessions/${session.id}/join`)
      .send({ participantName: 'Claude Agent', actorType: 'agent' });

    expect(res.status).toBe(200);
    expect(res.body.actorType).toBe('agent');
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(app)
      .post('/api/sessions/00000000-0000-0000-0000-000000000099/join')
      .send({ participantName: 'Ghost' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when participantName is missing', async () => {
    const session = await createSession(app);
    const res = await request(app)
      .post(`/api/sessions/${session.id}/join`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── Session state ─────────────────────────────────────────────────────────────

describe('GET /api/sessions/:id/state', () => {
  it('returns full session state after join', async () => {
    const session = await createSession(app, 'Alpha Sprint');
    await joinSession(app, session.id, 'Alice');

    const res = await request(app).get(`/api/sessions/${session.id}/state`);

    expect(res.status).toBe(200);
    expect(res.body.session.name).toBe('Alpha Sprint');
    expect(res.body.participants).toHaveLength(1);
    expect(res.body.intents).toHaveLength(0);
    expect(res.body.patches).toHaveLength(0);
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/sessions/00000000-0000-0000-0000-000000000099/state');
    expect(res.status).toBe(404);
  });
});

// ── Intent registration ───────────────────────────────────────────────────────

describe('POST /api/intents', () => {
  it('registers an intent successfully', async () => {
    const session = await createSession(app);
    const participant = await joinSession(app, session.id, 'Alice');

    const res = await request(app).post('/api/intents').send({
      sessionId: session.id,
      participantId: participant.id,
      description: 'Add OAuth2 support',
      filePaths: ['src/auth.ts'],
      functionNames: ['setupOAuth'],
      priority: 'blocking',
    });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Add OAuth2 support');
    expect(res.body.status).toBe('in_progress');
    expect(res.body.filePaths).toEqual(['src/auth.ts']);
  });

  it('returns 400 when filePaths is empty', async () => {
    const session = await createSession(app);
    const participant = await joinSession(app, session.id, 'Alice');
    const res = await request(app).post('/api/intents').send({
      sessionId: session.id,
      participantId: participant.id,
      description: 'Some task',
      filePaths: [],
    });
    expect(res.status).toBe(400);
  });
});

// ── Edit conflict check ───────────────────────────────────────────────────────

describe('POST /api/edits/check', () => {
  it('returns SAFE when no other participants are active', async () => {
    const session = await createSession(app);
    const alice = await joinSession(app, session.id, 'Alice');
    const intent = await registerIntent(app, session.id, alice.id);

    const res = await request(app).post('/api/edits/check').send({
      sessionId: session.id,
      participantId: alice.id,
      intentId: intent.id,
      filePath: 'src/auth/middleware.ts',
      diff: 'some changes',
      functionNames: ['verifyToken'],
    });

    expect(res.status).toBe(200);
    // Alice is the only participant, so checking against her own intent → SAFE
    expect(res.body.verdict).toBe('SAFE');
  });

  it('returns CONFLICT when another participant owns the same function', async () => {
    const session = await createSession(app);
    const alice = await joinSession(app, session.id, 'Alice');
    const bob = await joinSession(app, session.id, 'Bob');

    // Alice registers intent on verifyToken
    await registerIntent(app, session.id, alice.id, {
      filePaths: ['src/auth/middleware.ts'],
      functionNames: ['verifyToken'],
    });

    // Bob registers a separate intent
    const bobIntent = await registerIntent(app, session.id, bob.id, {
      filePaths: ['src/auth/middleware.ts'],
      functionNames: ['createSession'],
    });

    // Bob tries to edit verifyToken — should CONFLICT with Alice
    const res = await request(app).post('/api/edits/check').send({
      sessionId: session.id,
      participantId: bob.id,
      intentId: bobIntent.id,
      filePath: 'src/auth/middleware.ts',
      diff: '',
      functionNames: ['verifyToken'],
    });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('CONFLICT');
    expect(res.body.conflicts[0].participantName).toBe('Alice');
    expect(res.body.conflicts[0].overlapType).toBe('function');
  });

  it('returns REVIEW when same file but different functions', async () => {
    const session = await createSession(app);
    const alice = await joinSession(app, session.id, 'Alice');
    const bob = await joinSession(app, session.id, 'Bob');

    // Alice owns verifyToken
    await registerIntent(app, session.id, alice.id, {
      filePaths: ['src/auth/middleware.ts'],
      functionNames: ['verifyToken'],
    });

    const bobIntent = await registerIntent(app, session.id, bob.id, {
      filePaths: ['src/other.ts'],
      functionNames: [],
    });

    // Bob edits a completely different function in the same file
    const res = await request(app).post('/api/edits/check').send({
      sessionId: session.id,
      participantId: bob.id,
      intentId: bobIntent.id,
      filePath: 'src/auth/middleware.ts',
      diff: '',
      functionNames: ['requireRole'],  // different function from Alice
    });

    expect(res.status).toBe(200);
    // Different function → file-level claim exists but no fn overlap → REVIEW
    expect(res.body.verdict).toBe('REVIEW');
  });
});

// ── Shadow patches ────────────────────────────────────────────────────────────

describe('Patch lifecycle: propose → approve', () => {
  it('creates a pending patch, then approves it', async () => {
    const session = await createSession(app);
    const alice = await joinSession(app, session.id, 'Alice');
    const bob = await joinSession(app, session.id, 'Bob');
    const intent = await registerIntent(app, session.id, alice.id);

    // Alice proposes a patch
    const proposeRes = await request(app).post('/api/patches').send({
      sessionId: session.id,
      intentId: intent.id,
      proposerId: alice.id,
      filePath: 'src/auth/middleware.ts',
      diff: '--- a/src/auth/middleware.ts\n+++ b/src/auth/middleware.ts\n@@ -1 +1 @@\n-old\n+new',
      reason: 'Add token expiry check',
    });

    expect(proposeRes.status).toBe(200);
    expect(proposeRes.body.status).toBe('pending');
    const patchId = proposeRes.body.id;

    // Bob approves it
    const approveRes = await request(app)
      .post(`/api/patches/${patchId}/approve`)
      .send({ reviewerId: bob.id });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('approved');
    expect(approveRes.body.reviewedBy).toBe(bob.id);
  });

  it('can reject a patch', async () => {
    const session = await createSession(app);
    const alice = await joinSession(app, session.id, 'Alice');
    const bob = await joinSession(app, session.id, 'Bob');
    const intent = await registerIntent(app, session.id, alice.id);

    const proposeRes = await request(app).post('/api/patches').send({
      sessionId: session.id,
      intentId: intent.id,
      proposerId: alice.id,
      filePath: 'src/auth/middleware.ts',
      diff: 'some diff',
      reason: 'Experimental change',
    });
    const patchId = proposeRes.body.id;

    const rejectRes = await request(app)
      .post(`/api/patches/${patchId}/reject`)
      .send({ reviewerId: bob.id });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe('rejected');
  });
});

// ── Intent lifecycle ──────────────────────────────────────────────────────────

describe('Intent lifecycle: complete and cancel', () => {
  it('marks an intent as complete', async () => {
    const session = await createSession(app);
    const alice = await joinSession(app, session.id, 'Alice');
    const intent = await registerIntent(app, session.id, alice.id);

    const res = await request(app).patch(`/api/intents/${intent.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('complete');
    expect(res.body.completedAt).toBeTruthy();
  });

  it('cancels an intent', async () => {
    const session = await createSession(app);
    const alice = await joinSession(app, session.id, 'Alice');
    const intent = await registerIntent(app, session.id, alice.id);

    const res = await request(app).patch(`/api/intents/${intent.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('returns 404 for unknown intent', async () => {
    const res = await request(app).patch('/api/intents/00000000-0000-0000-0000-000000000099/complete');
    expect(res.status).toBe(404);
  });
});

// ── GitHub sync ───────────────────────────────────────────────────────────────

describe('POST /api/sessions/:id/sync', () => {
  it('returns a commit message summarising the session', async () => {
    const session = await createSession(app, 'Demo Sprint');
    const alice = await joinSession(app, session.id, 'Alice');
    const intent = await registerIntent(app, session.id, alice.id);

    // Complete the intent so it shows in the summary
    await request(app).patch(`/api/intents/${intent.id}/complete`);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/sync`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.commitMessage).toContain('Demo Sprint');
    expect(res.body.commitMessage).toContain('Alice');
    expect(res.body.summary.completedIntents).toBe(1);
    expect(res.body.committed).toBe(false); // no repoPath provided
  });
});
