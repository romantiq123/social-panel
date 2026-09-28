import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
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
  if (getCookie(c, COOKIE) === sessionToken()) return next();
  return c.json({ error: 'unauthorized' }, 401);
}
