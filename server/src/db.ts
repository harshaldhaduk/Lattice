// Uses Node.js built-in SQLite (available since Node 22.5 — no native compilation needed)
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_PATH = path.join(__dirname, '../../lattice.db');

export const db = new DatabaseSync(DB_PATH);

export function initDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_url TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      agent_type TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      current_task TEXT,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      participant_name TEXT NOT NULL,
      description TEXT NOT NULL,
      file_scope TEXT NOT NULL DEFAULT '[]',
      function_scope TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'in_progress',
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS patches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      proposer_id TEXT NOT NULL,
      proposer_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      diff TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS negotiations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_participant_id TEXT NOT NULL,
      to_participant_id TEXT NOT NULL,
      message TEXT NOT NULL,
      message_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  console.log('Database initialized at', DB_PATH);
}
