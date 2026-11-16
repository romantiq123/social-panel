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

const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

const DEFAULTS: Settings = {
  public_base_url:
    process.env.PUBLIC_BASE_URL ??
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : vercelUrl ? `https://${vercelUrl}` : ''),
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

/**
 * Таблица settings кэшируется в памяти: на сервере её перечитывают в начале каждого запроса
 * (loadSettings), а getSettings/getInternal остаются синхронными.
 */
let cache: Map<string, string> | null = null;

export async function loadSettings() {
  const rows = (await db.prepare('SELECT key, value FROM settings').all()) as { key: string; value: string }[];
  cache = new Map(rows.map((r) => [r.key, r.value]));
}

function rows() {
  if (!cache) throw new Error('Настройки не загружены (loadSettings)');
  return cache;
}

export function getSettings(): Settings {
  const s: Record<string, unknown> = { ...DEFAULTS };
  for (const [key, value] of rows()) {
    if (key in DEFAULTS) s[key] = typeof (DEFAULTS as any)[key] === 'number' ? Number(value) : value;
  }
  // На Vercel публичный адрес по умолчанию — домен проекта, если в базе не задан другой
  if (!s.public_base_url) s.public_base_url = DEFAULTS.public_base_url;
  s.public_base_url = String(s.public_base_url).replace(/\/+$/, '');
  return s as unknown as Settings;
}

const UPSERT = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

export async function updateSettings(patch: Partial<Record<keyof Settings, unknown>>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS) || v === undefined || v === null) continue;
    await db.prepare(UPSERT).run(k, String(v));
    rows().set(k, String(v));
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
  return rows().get(`_${key}`);
}
export async function setInternal(key: string, value: string) {
  await db.prepare(UPSERT).run(`_${key}`, value);
  rows().set(`_${key}`, value);
}
