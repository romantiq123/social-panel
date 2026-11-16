import './paths.ts';
import postgres from 'postgres';

/**
 * Postgres (Supabase). Строку подключения даёт интеграция Supabase ↔ Vercel (POSTGRES_URL),
 * локально — DATABASE_URL в .env.
 * API похоже на старый node:sqlite (db.prepare(sql).get/all/run), только всё асинхронно.
 */
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error('Не задан DATABASE_URL / POSTGRES_URL');

// prepare:false — нужно для транзакционного пулера Supabase (порт 6543)
export const sql = postgres(url, {
  prepare: false,
  max: process.env.VERCEL ? 3 : 10,
  idle_timeout: 20,
  connect_timeout: 15,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
  onnotice: () => {},
});

/** SQLite-плейсхолдеры `?` → `$1, $2…` */
function toPg(q: string) {
  let i = 0;
  return q.replace(/\?/g, () => `$${++i}`);
}
const clean = (args: unknown[]) => args.map((a) => (a === undefined ? null : a)) as any[];

export const db = {
  prepare(q: string) {
    const text = toPg(q);
    return {
      all: async (...args: unknown[]): Promise<any[]> => [...(await sql.unsafe(text, clean(args)))],
      get: async (...args: unknown[]): Promise<any> => (await sql.unsafe(text, clean(args)))[0],
      run: async (...args: unknown[]) => ({ changes: (await sql.unsafe(text, clean(args))).count }),
    };
  },
  exec: (q: string) => sql.unsafe(q),
};

const SCHEMA = `
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

CREATE TABLE IF NOT EXISTS oauth_clients (
  id            TEXT PRIMARY KEY,
  secret_hash   TEXT,
  name          TEXT,
  redirect_uris TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  hash         TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  challenge    TEXT NOT NULL,
  scope        TEXT,
  resource     TEXT,
  expires_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  hash       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  client_id  TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scope      TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id         BIGSERIAL PRIMARY KEY,
  level      TEXT NOT NULL,
  source     TEXT NOT NULL,
  message    TEXT NOT NULL,
  channel_id TEXT,
  post_id    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
`;

let ready: Promise<void> | null = null;
/** Схема создаётся один раз на холодный старт */
export function ensureSchema() {
  ready ??= sql
    .unsafe(SCHEMA)
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

export async function log(level: 'info' | 'warn' | 'error', source: string, message: string, ref: { channel_id?: string; post_id?: string } = {}) {
  // stdout зарезервирован под MCP-протокол, поэтому только stderr
  console.error(`[${level}] ${source}: ${message}`);
  try {
    await db
      .prepare('INSERT INTO logs (level, source, message, channel_id, post_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(level, source, message, ref.channel_id ?? null, ref.post_id ?? null, now());
  } catch (e: any) {
    console.error('[log] не записан в БД:', e.message);
  }
}
