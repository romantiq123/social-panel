import { ROOT } from './paths.ts';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// На Railway сюда монтируется volume (DATA_DIR=/data)
export const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
for (const dir of [DATA_DIR, UPLOAD_DIR]) if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'panel.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id                 TEXT PRIMARY KEY,
  provider           TEXT NOT NULL CHECK (provider IN ('threads','instagram')),
  external_id        TEXT NOT NULL,
  username           TEXT NOT NULL,
  name               TEXT,
  avatar_url         TEXT,
  access_token       TEXT NOT NULL,
  token_expires_at   TEXT,
  token_refreshed_at TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  last_error         TEXT,
  time_slots         TEXT NOT NULL DEFAULT '["09:00","13:00","19:00"]',
  followers_count    INTEGER,
  created_at         TEXT NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  original_name TEXT,
  mime          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('image','video')),
  size          INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('draft','scheduled','publishing','published','failed')),
  content      TEXT NOT NULL DEFAULT '',
  media        TEXT NOT NULL DEFAULT '[]',
  options      TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT,
  published_at TEXT,
  external_id  TEXT,
  permalink    TEXT,
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  insights     TEXT,
  insights_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_sched ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_id);

CREATE TABLE IF NOT EXISTS signatures (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT NOT NULL,
  source     TEXT NOT NULL,
  message    TEXT NOT NULL,
  channel_id TEXT,
  post_id    TEXT,
  created_at TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

export function log(level: 'info' | 'warn' | 'error', source: string, message: string, ref: { channel_id?: string; post_id?: string } = {}) {
  db.prepare('INSERT INTO logs (level, source, message, channel_id, post_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(level, source, message, ref.channel_id ?? null, ref.post_id ?? null, now());
  // stdout зарезервирован под MCP-протокол, поэтому только stderr
  console.error(`[${level}] ${source}: ${message}`);
}

/** Атомарно выполняет fn в транзакции */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
