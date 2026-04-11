import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { initDb, db } from './db';
import { createRouter } from './routes';
import type { ServerToClientEvents, ClientToServerEvents } from '@lattice/shared';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

const app = express();
const httpServer = createServer(app);

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use('/api', createRouter(io));

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── WebSocket: session room management ───────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('session:join', ({ sessionId, participantId }) => {
    socket.join(sessionId);
    // Update participant status to online
    db.prepare(`UPDATE participants SET status = 'online', last_seen = ? WHERE id = ?`)
      .run(new Date().toISOString(), participantId);
    console.log(`Participant ${participantId} joined room ${sessionId}`);
  });

  socket.on('presence:update', ({ participantId, currentTask, status }) => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE participants SET current_task = ?, status = ?, last_seen = ? WHERE id = ?`)
      .run(currentTask, status, now, participantId);

    // Find which session this participant belongs to
    const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId) as any;
    if (row) {
      io.to(row.session_id).emit('presence:changed', {
        id: row.id, sessionId: row.session_id, name: row.name,
        agentType: row.agent_type, status, currentTask, lastSeen: now,
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────────
initDb();
httpServer.listen(PORT, () => {
  console.log(`Lattice server running on http://localhost:${PORT}`);
  console.log(`WebSocket ready on ws://localhost:${PORT}`);
});
