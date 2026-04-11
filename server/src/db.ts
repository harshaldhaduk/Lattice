// Uses Node.js built-in SQLite (available since Node 22.5 — no native compilation needed)
// If you get schema errors, delete lattice.db and restart the server.
// Set LATTICE_DB_PATH=':memory:' in tests for an isolated in-memory database.
//
// node:sqlite is a Node 22.5+ built-in. We use require() so that
// Vite/vitest doesn't try to statically resolve it during test collection.
// The server compiles as CommonJS so require is always available.
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '../../lattice.db');
const DB_PATH = process.env.LATTICE_DB_PATH ?? DEFAULT_DB_PATH;

export const db = new DatabaseSync(DB_PATH);

export function initDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      repo_url   TEXT,
      created_at TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS participants (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES sessions(id),
      name         TEXT NOT NULL,
      actor_type   TEXT NOT NULL DEFAULT 'human',
      status       TEXT NOT NULL DEFAULT 'online',
      current_task TEXT,
      last_seen    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intents (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL REFERENCES sessions(id),
      participant_id   TEXT NOT NULL REFERENCES participants(id),
      participant_name TEXT NOT NULL,
      actor_type       TEXT NOT NULL DEFAULT 'human',
      description      TEXT NOT NULL,
      file_paths       TEXT NOT NULL DEFAULT '[]',
      function_names   TEXT NOT NULL DEFAULT '[]',
      start_line       INTEGER,
      end_line         INTEGER,
      status           TEXT NOT NULL DEFAULT 'in_progress',
      priority         TEXT NOT NULL DEFAULT 'normal',
      created_at       TEXT NOT NULL,
      completed_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS patches (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id),
      intent_id     TEXT NOT NULL REFERENCES intents(id),
      proposer_id   TEXT NOT NULL REFERENCES participants(id),
      proposer_name TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      diff          TEXT NOT NULL,
      reason        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      reviewed_by   TEXT,
      reviewed_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      event_type  TEXT NOT NULL,
      actor_id    TEXT NOT NULL,
      actor_name  TEXT NOT NULL,
      target_id   TEXT,
      target_name TEXT,
      message     TEXT NOT NULL,
      metadata    TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
    CREATE INDEX IF NOT EXISTS idx_intents_session      ON intents(session_id);
    CREATE INDEX IF NOT EXISTS idx_intents_participant  ON intents(participant_id);
    CREATE INDEX IF NOT EXISTS idx_intents_status       ON intents(status);
    CREATE INDEX IF NOT EXISTS idx_patches_session      ON patches(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_session       ON events(session_id);
  `);

  console.log('Database initialized at', DB_PATH);
}
