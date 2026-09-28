import { db } from './db.ts';

export interface Settings {
  public_base_url: string;
  graph_version_threads: string;
  graph_version_instagram: string;
  threads_app_id: string;
  threads_app_secret: string;
  instagram_app_id: string;
  instagram_app_secret: string;
  timezone: string;
  refresh_days_before: number;
}

const DEFAULTS: Settings = {
  // Railway сам отдаёт публичный домен сервиса
  public_base_url: process.env.PUBLIC_BASE_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''),
  graph_version_threads: 'v1.0',
  graph_version_instagram: 'v23.0',
  threads_app_id: process.env.THREADS_APP_ID ?? '',
  threads_app_secret: process.env.THREADS_APP_SECRET ?? '',
  instagram_app_id: process.env.INSTAGRAM_APP_ID ?? '',
  instagram_app_secret: process.env.INSTAGRAM_APP_SECRET ?? '',
  timezone: 'Asia/Almaty',
  refresh_days_before: 10,
};

export const SECRET_KEYS = ['threads_app_secret', 'instagram_app_secret'] as const;

export function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const s: Record<string, unknown> = { ...DEFAULTS };
  for (const { key, value } of rows) {
    if (key in DEFAULTS) s[key] = typeof (DEFAULTS as any)[key] === 'number' ? Number(value) : value;
  }
  s.public_base_url = String(s.public_base_url).replace(/\/+$/, '');
  return s as unknown as Settings;
}

export function updateSettings(patch: Partial<Record<keyof Settings, unknown>>) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS) || v === undefined || v === null) continue;
    stmt.run(k, String(v));
  }
  return getSettings();
}

/** Для UI: секреты маскируем */
export function publicSettings() {
  const s = getSettings();
  const out: Record<string, unknown> = { ...s };
  for (const k of SECRET_KEYS) out[k] = s[k] ? '••••••••' + s[k].slice(-4) : '';
  return out;
}

/** Внутренние значения (пароль, секрет сессии) — не показываются в UI */
export function getInternal(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`_${key}`) as { value: string } | undefined;
  return row?.value;
}
export function setInternal(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`_${key}`, value);
}
