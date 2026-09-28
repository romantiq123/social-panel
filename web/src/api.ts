export type Provider = 'threads' | 'instagram';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

export interface Channel {
  id: string;
  provider: Provider;
  external_id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
  token_expires_at: string | null;
  token_refreshed_at: string | null;
  token_days_left: number | null;
  token_preview: string;
  status: 'active' | 'expired' | 'error';
  last_error: string | null;
  time_slots: string[];
  followers_count: number | null;
  created_at: string;
}

export interface Media {
  id: string;
  filename: string;
  original_name: string | null;
  mime: string;
  kind: 'image' | 'video';
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  public_url: string;
  created_at: string;
}

export interface MediaRef {
  id: string;
  kind: 'image' | 'video';
  url?: string;
}

export interface PostOptions {
  threads?: {
    topic_tag?: string;
    reply_control?: 'everyone' | 'accounts_you_follow' | 'mentioned_only';
    thread?: { text: string; media?: MediaRef[] }[];
  };
  instagram?: { type?: 'feed' | 'reel' | 'story'; first_comment?: string; share_to_feed?: boolean };
}

export interface Post {
  id: string;
  group_id: string;
  channel_id: string;
  status: PostStatus;
  content: string;
  media: (MediaRef & { url: string })[];
  options: PostOptions;
  scheduled_at: string | null;
  published_at: string | null;
  external_id: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  insights: Record<string, number> | null;
  insights_at: string | null;
  created_at: string;
  updated_at: string;
  channel: { id: string; provider: Provider; username: string; avatar_url: string | null } | null;
}

export interface Signature {
  id: string;
  name: string;
  content: string;
}

export interface LogEntry {
  id: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  channel_id: string | null;
  post_id: string | null;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') onUnauthorized();
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}

export const api = {
  get: <T>(url: string) => req<T>('GET', url),
  post: <T>(url: string, body?: unknown) => req<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => req<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => req<T>('PATCH', url, body),
  del: <T>(url: string) => req<T>('DELETE', url),
  upload: (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    return req<Media[]>('POST', '/api/media', fd);
  },
};

export const LIMITS: Record<Provider, { text: number; media: number; label: string }> = {
  threads: { text: 500, media: 20, label: 'Threads' },
  instagram: { text: 2200, media: 10, label: 'Instagram' },
};

const EMOJI = /\p{Extended_Pictographic}/u;
const enc = new TextEncoder();
export function textLength(text: string, provider: Provider) {
  if (provider !== 'threads') return [...text].length;
  let n = 0;
  for (const ch of text) n += EMOJI.test(ch) ? enc.encode(ch).length : 1;
  return n;
}

/* ------------------------------ Date helpers ------------------------------ */

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Date → значение для <input type="datetime-local"> */
export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (s: string) => (s ? new Date(s).toISOString() : null);

export const postDate = (p: Post) => p.published_at ?? p.scheduled_at ?? p.updated_at;

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Черновик',
  scheduled: 'Запланирован',
  publishing: 'Публикуется',
  published: 'Опубликован',
  failed: 'Ошибка',
};
