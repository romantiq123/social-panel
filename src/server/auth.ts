import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getInternal, setInternal } from '../core/settings.ts';

export const COOKIE = 'sp_session';

export function ensurePassword(): string {
  if (process.env.PANEL_PASSWORD) return process.env.PANEL_PASSWORD;
  let p = getInternal('password');
  if (!p) {
    p = randomBytes(9).toString('base64url');
    setInternal('password', p);
  }
  return p;
}

function secret() {
  let s = getInternal('session_secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
    setInternal('session_secret', s);
  }
  return s;
}

/** Токен сессии зависит от пароля — смена пароля разлогинивает всех */
export function sessionToken() {
  return createHmac('sha256', secret()).update(ensurePassword()).digest('hex');
}

export const isLoggedIn = (c: Context) => getCookie(c, COOKIE) === sessionToken();

export function startSession(c: Context) {
  const secure = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
  setCookie(c, COOKIE, sessionToken(), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30, secure });
}

/** HMAC на секрете сессии — для CSRF-токенов и подписей */
export const sign = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url');

/* Простой лимит на перебор пароля: 10 неудач за 15 минут с одного IP */
const failures = new Map<string, number[]>();
export const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';
export function tooManyAttempts(ip: string) {
  const since = Date.now() - 15 * 60_000;
  const list = (failures.get(ip) ?? []).filter((t) => t > since);
  failures.set(ip, list);
  return list.length >= 10;
}
export function recordFailure(ip: string) {
  failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);
}

/** Bearer-токен для удалённого MCP (/mcp) */
export function mcpToken(rotate = false): string {
  if (process.env.MCP_TOKEN) return process.env.MCP_TOKEN;
  let t = getInternal('mcp_token');
  if (!t || rotate) {
    t = 'spm_' + randomBytes(24).toString('base64url');
    setInternal('mcp_token', t);
  }
  return t;
}

export function checkBearer(header: string | undefined) {
  const got = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const want = Buffer.from(mcpToken());
  return got.length === want.length && timingSafeEqual(got, want);
}

export function checkPassword(input: string) {
  const a = Buffer.from(String(input));
  const b = Buffer.from(ensurePassword());
  return a.length === b.length && timingSafeEqual(a, b);
}

const PUBLIC = [/^\/media\//, /^\/oauth\/[^/]+\/callback/, /^\/api\/login$/, /^\/api\/health$/];

export async function authMiddleware(c: Context, next: Next) {
  const path = new URL(c.req.url).pathname;
  const needsAuth = path.startsWith('/api/') || path.startsWith('/oauth/');
  if (!needsAuth || PUBLIC.some((r) => r.test(path))) return next();
  if (isLoggedIn(c)) return next();
  return c.json({ error: 'unauthorized' }, 401);
}
