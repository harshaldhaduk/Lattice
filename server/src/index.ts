import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { initDb, db } from './db';
import { createRouter } from './routes';
import type { ServerToClientEvents, ClientToServerEvents } from '@lattice/shared';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
// Mark participants offline after 45 s without a heartbeat
const HEARTBEAT_TIMEOUT_MS = 45_000;

const app = express();
const httpServer = createServer(app);

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH'] },
});

app.use(cors());
app.use(express.json());
app.use('/api', createRouter(io));

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── WebSocket: room + presence management ────────────────────────────────────

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('session:join', ({ sessionId, participantId }) => {
    socket.join(sessionId);
    db.prepare(`UPDATE participants SET status = 'online', last_seen = ? WHERE id = ?`)
      .run(new Date().toISOString(), participantId);
    console.log(`Participant ${participantId} joined room ${sessionId}`);
  });

  socket.on('presence:update', ({ participantId, currentTask, status }) => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE participants SET current_task = ?, status = ?, last_seen = ? WHERE id = ?`)
      .run(currentTask ?? null, status ?? 'online', now, participantId);

    const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId) as any;
    if (row) {
      io.to(row.session_id).emit('presence:changed', {
        id: row.id,
        sessionId: row.session_id,
        name: row.name,
        actorType: row.actor_type ?? 'human',
        status: status ?? 'online',
        currentTask: currentTask ?? undefined,
        lastSeen: now,
      });
    }
  });

  socket.on('heartbeat', ({ participantId }) => {
    db.prepare(`UPDATE participants SET last_seen = ? WHERE id = ?`)
      .run(new Date().toISOString(), participantId);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ── Stale-participant sweeper (marks offline after HEARTBEAT_TIMEOUT_MS) ────

setInterval(() => {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();
  const stale = db.prepare(`
    SELECT id, session_id FROM participants
    WHERE status != 'offline' AND last_seen < ?
  `).all(cutoff) as { id: string; session_id: string }[];

  for (const { id, session_id } of stale) {
    db.prepare(`UPDATE participants SET status = 'offline' WHERE id = ?`).run(id);
    const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as any;
    if (row) {
      io.to(session_id).emit('presence:changed', {
        id: row.id,
        sessionId: row.session_id,
        name: row.name,
        actorType: row.actor_type ?? 'human',
        status: 'offline',
        currentTask: row.current_task ?? undefined,
        lastSeen: row.last_seen,
      });
    }
  }
}, 15_000);

// ── Boot ─────────────────────────────────────────────────────────────────────
initDb();
httpServer.listen(PORT, () => {
  console.log(`Lattice server running on http://localhost:${PORT}`);
  console.log(`WebSocket ready on ws://localhost:${PORT}`);
});
