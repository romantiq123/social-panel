/**
 * OAuth 2.1 авторизация для удалённого MCP по спецификации MCP:
 * - RFC 9728 Protected Resource Metadata
 * - RFC 8414 Authorization Server Metadata
 * - RFC 7591 Dynamic Client Registration (Claude регистрирует себя сам)
 * - Authorization Code + PKCE (S256), refresh-токены с ротацией
 *
 * Вход на странице подтверждения — паролем панели (или уже открытой сессией).
 */
import { Hono, type Context } from 'hono';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, log, now } from '../core/db.ts';
import { getSettings } from '../core/settings.ts';
import { checkPassword, clientIp, isLoggedIn, recordFailure, sign, startSession, tooManyAttempts } from './auth.ts';

const ACCESS_TTL = 60 * 60; // 1 час
const REFRESH_TTL = 90 * 24 * 60 * 60; // 90 дней
const CODE_TTL = 5 * 60;
const MAX_CLIENTS = 100;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = (prefix: string) => prefix + randomBytes(32).toString('base64url');
const inSec = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function baseUrl(c: Context) {
  const configured = getSettings().public_base_url;
  if (configured) return configured;
  const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  return `${proto}://${host}`;
}

interface ClientRow {
  id: string;
  secret_hash: string | null;
  name: string | null;
  redirect_uris: string;
  created_at: string;
  last_used_at: string | null;
}

const getClient = (id: string) => db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as unknown as ClientRow | undefined;

/** Проверка access-токена для /mcp */
export function verifyAccessToken(header: string | undefined): boolean {
  const t = header?.replace(/^Bearer\s+/i, '');
  if (!t) return false;
  const row = db.prepare(`SELECT client_id FROM oauth_tokens WHERE hash = ? AND kind = 'access' AND expires_at > ?`).get(sha(t), now()) as
    | { client_id: string }
    | undefined;
  if (!row) return false;
  db.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE id = ?').run(now(), row.client_id);
  return true;
}

/** Заголовок для 401 на /mcp — по нему клиент находит OAuth */
export const wwwAuthenticate = (c: Context, invalid: boolean) =>
  `Bearer resource_metadata="${baseUrl(c)}/.well-known/oauth-protected-resource"${invalid ? ', error="invalid_token"' : ''}`;

export function listClients() {
  return (db.prepare('SELECT id, name, redirect_uris, created_at, last_used_at FROM oauth_clients ORDER BY COALESCE(last_used_at, created_at) DESC').all() as unknown as ClientRow[]).map(
    (c) => ({ ...c, redirect_uris: JSON.parse(c.redirect_uris) as string[] }),
  );
}
export function revokeClient(id: string) {
  db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id);
}

function issueTokens(clientId: string, scope: string | null) {
  db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(now());
  const access = newToken('spa_');
  const refresh = newToken('spr_');
  const ins = db.prepare('INSERT INTO oauth_tokens (hash, kind, client_id, scope, expires_at, created_at) VALUES (?,?,?,?,?,?)');
  ins.run(sha(access), 'access', clientId, scope, inSec(ACCESS_TTL), now());
  ins.run(sha(refresh), 'refresh', clientId, scope, inSec(REFRESH_TTL), now());
  db.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE id = ?').run(now(), clientId);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: scope ?? 'mcp' };
}

const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) =>
  c.json({ error, error_description: description }, status, { 'Cache-Control': 'no-store' });

/* ------------------------------------------------------------------------ */

export const mcpAuth = new Hono();

// CORS: браузерные MCP-клиенты (например, MCP Inspector) ходят сюда напрямую
mcpAuth.use('*', async (c, next) => {
  const p = new URL(c.req.url).pathname;
  const cors = p === '/mcp' || p.startsWith('/.well-known/') || p === '/mcp-auth/token' || p === '/mcp-auth/register' || p === '/mcp-auth/revoke';
  if (cors && c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  if (cors) {
    c.res.headers.set('Access-Control-Allow-Origin', '*');
    c.res.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  }
});

const resourceMetadata = (c: Context) => {
  const base = baseUrl(c);
  return c.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
    resource_name: 'Social Panel',
  });
};

const serverMetadata = (c: Context) => {
  const base = baseUrl(c);
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/mcp-auth/authorize`,
    token_endpoint: `${base}/mcp-auth/token`,
    registration_endpoint: `${base}/mcp-auth/register`,
    revocation_endpoint: `${base}/mcp-auth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
  });
};

// Клиенты запрашивают и корневой, и «суффиксный» вариант (…/oauth-protected-resource/mcp)
mcpAuth.get('/.well-known/oauth-protected-resource', resourceMetadata);
mcpAuth.get('/.well-known/oauth-protected-resource/*', resourceMetadata);
mcpAuth.get('/.well-known/oauth-authorization-server', serverMetadata);
mcpAuth.get('/.well-known/oauth-authorization-server/*', serverMetadata);
mcpAuth.get('/.well-known/openid-configuration', serverMetadata);

/* ------------------------- Dynamic Client Registration ------------------------ */

mcpAuth.post('/mcp-auth/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const uris: unknown = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length) return oauthError(c, 'invalid_redirect_uri', 'redirect_uris обязателен');
  for (const u of uris) {
    let url: URL;
    try {
      url = new URL(String(u));
    } catch {
      return oauthError(c, 'invalid_redirect_uri', `Некорректный redirect_uri: ${u}`);
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return oauthError(c, 'invalid_redirect_uri', 'redirect_uri должен быть https (или http://localhost)');
  }
  const count = (db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get() as { n: number }).n;
  if (count >= MAX_CLIENTS) {
    // вытесняем самый старый неиспользованный
    const old = db.prepare('SELECT id FROM oauth_clients WHERE last_used_at IS NULL ORDER BY created_at LIMIT 1').get() as { id: string } | undefined;
    if (!old) return oauthError(c, 'invalid_client_metadata', 'Слишком много зарегистрированных клиентов — отзовите лишние в Настройках');
    revokeClient(old.id);
  }

  const method = body.token_endpoint_auth_method ?? 'none';
  const id = 'spc_' + randomBytes(12).toString('base64url');
  const secret = method === 'none' ? null : newToken('sps_');
  const name = String(body.client_name ?? 'MCP client').slice(0, 100);
  db.prepare('INSERT INTO oauth_clients (id, secret_hash, name, redirect_uris, created_at) VALUES (?,?,?,?,?)').run(id, secret ? sha(secret) : null, name, JSON.stringify(uris), now());
  log('info', 'mcp-oauth', `Зарегистрирован клиент «${name}»`);
  return c.json(
    {
      client_id: id,
      ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: secret ? method : 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  );
});

/* ------------------------------- Authorization ------------------------------ */

const AUTH_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const;
type AuthParams = Partial<Record<(typeof AUTH_PARAMS)[number], string>>;

const csrfFor = (p: AuthParams) => sign(['authz', p.client_id, p.redirect_uri, p.code_challenge, p.state ?? ''].join('|'));

function redirectWith(uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

/** Ошибки, при которых нельзя редиректить (клиент/redirect_uri не доверенные) */
function checkClient(p: AuthParams): { client: ClientRow } | { error: string } {
  if (!p.client_id) return { error: 'Не передан client_id' };
  const client = getClient(p.client_id);
  if (!client) return { error: 'Неизвестный клиент. Удалите коннектор в Claude и добавьте заново.' };
  const uris = JSON.parse(client.redirect_uris) as string[];
  if (!p.redirect_uri || !uris.includes(p.redirect_uri)) return { error: 'redirect_uri не совпадает с зарегистрированным' };
  return { client };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function page(title: string, body: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fafafa;--card:#fff;--fg:#18181b;--muted:#71717a;--line:#e4e4e7;--brand:#7c3aed;--brand2:#6d28d9;--err:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
.logo{width:44px;height:44px;border-radius:12px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin:0 auto 14px}
h1{font-size:18px;text-align:center;margin:0 0 6px}p{color:var(--muted);text-align:center;margin:0 0 18px;font-size:14px}
.box{border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px}.box b{color:var(--fg)}.box div{color:var(--muted);word-break:break-all}
ul{margin:6px 0 0;padding-left:18px;color:var(--muted)}
input{width:100%;height:40px;border:1px solid var(--line);border-radius:10px;padding:0 12px;background:transparent;color:var(--fg);font-size:15px;margin-bottom:12px}
input:focus{outline:2px solid color-mix(in srgb,var(--brand) 35%,transparent);border-color:var(--brand)}
.row{display:flex;gap:8px}button{flex:1;height:40px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--fg);font-size:14px;font-weight:600;cursor:pointer}
button.primary{background:var(--brand);border-color:var(--brand);color:#fff}button.primary:hover{background:var(--brand2)}
.err{color:var(--err);font-size:13px;text-align:center;margin:-4px 0 12px}
</style></head><body><div class="card"><div class="logo">SP</div>${body}</div></body></html>`;
}

function consentPage(p: AuthParams, client: ClientRow, loggedIn: boolean, error?: string) {
  const hidden = AUTH_PARAMS.map((k) => (p[k] ? `<input type="hidden" name="${k}" value="${esc(p[k]!)}">` : '')).join('');
  const host = new URL(p.redirect_uri!).host;
  return page(
    'Доступ к Social Panel',
    `<h1>Разрешить доступ?</h1>
<p><b>${esc(client.name ?? 'MCP client')}</b> хочет управлять вашей панелью</p>
<div class="box"><b>Сможет:</b><ul><li>читать каналы, посты и статистику</li><li>создавать, планировать и публиковать посты</li><li>загружать медиа и обновлять токены</li></ul>
<div style="margin-top:10px">Ответ уйдёт на: <b>${esc(host)}</b></div></div>
<form method="post" action="/mcp-auth/authorize">${hidden}<input type="hidden" name="csrf" value="${csrfFor(p)}">
${error ? `<div class="err">${esc(error)}</div>` : ''}
${loggedIn ? '' : '<input type="password" name="password" placeholder="Пароль панели" autofocus required>'}
<div class="row"><button name="action" value="deny" formnovalidate>Отклонить</button><button class="primary" name="action" value="allow">Разрешить</button></div>
</form>`,
  );
}

mcpAuth.get('/mcp-auth/authorize', (c) => {
  const q = c.req.query();
  const p: AuthParams = Object.fromEntries(AUTH_PARAMS.map((k) => [k, q[k]]));
  const chk = checkClient(p);
  if ('error' in chk) return c.html(page('Ошибка', `<h1>Ошибка авторизации</h1><p>${esc(chk.error)}</p>`), 400);
  if (p.response_type !== 'code') return c.redirect(redirectWith(p.redirect_uri!, { error: 'unsupported_response_type', state: p.state }));
  if (!p.code_challenge || p.code_challenge_method !== 'S256')
    return c.redirect(redirectWith(p.redirect_uri!, { error: 'invalid_request', error_description: 'Требуется PKCE (S256)', state: p.state }));
  return c.html(consentPage(p, chk.client, isLoggedIn(c)));
});

mcpAuth.post('/mcp-auth/authorize', async (c) => {
  const form = await c.req.parseBody();
  const p: AuthParams = Object.fromEntries(AUTH_PARAMS.map((k) => [k, typeof form[k] === 'string' ? (form[k] as string) : undefined]));
  const chk = checkClient(p);
  if ('error' in chk) return c.html(page('Ошибка', `<h1>Ошибка авторизации</h1><p>${esc(chk.error)}</p>`), 400);
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return c.redirect(redirectWith(p.redirect_uri!, { error: 'invalid_request', state: p.state }));
  if (!safeEq(String(form.csrf ?? ''), csrfFor(p))) return c.html(page('Ошибка', '<h1>Сессия устарела</h1><p>Начните подключение заново.</p>'), 400);

  if (form.action === 'deny') return c.redirect(redirectWith(p.redirect_uri!, { error: 'access_denied', state: p.state }));

  if (!isLoggedIn(c)) {
    const ip = clientIp(c);
    if (tooManyAttempts(ip)) return c.html(consentPage(p, chk.client, false, 'Слишком много попыток, подождите 15 минут'), 429);
    if (!checkPassword(String(form.password ?? ''))) {
      recordFailure(ip);
      return c.html(consentPage(p, chk.client, false, 'Неверный пароль'), 401);
    }
    startSession(c);
  }

  const code = newToken('spk_');
  db.prepare('INSERT INTO oauth_codes (hash, client_id, redirect_uri, challenge, scope, resource, expires_at) VALUES (?,?,?,?,?,?,?)').run(
    sha(code),
    chk.client.id,
    p.redirect_uri!,
    p.code_challenge,
    p.scope ?? 'mcp',
    p.resource ?? null,
    inSec(CODE_TTL),
  );
  log('info', 'mcp-oauth', `Доступ выдан клиенту «${chk.client.name}»`);
  return c.redirect(redirectWith(p.redirect_uri!, { code, state: p.state }));
});

/* ----------------------------------- Token ---------------------------------- */

async function readBody(c: Context): Promise<Record<string, string>> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/json')) return (await c.req.json().catch(() => ({}))) as Record<string, string>;
  const b = await c.req.parseBody();
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v)]));
}

/** Аутентификация клиента: публичные — только client_id, конфиденциальные — секрет */
function authClient(c: Context, body: Record<string, string>): ClientRow | null {
  let id = body.client_id;
  let secret = body.client_secret;
  const basic = c.req.header('authorization')?.match(/^Basic\s+(.+)$/i);
  if (basic) {
    const [u, s] = Buffer.from(basic[1], 'base64').toString().split(':');
    id = decodeURIComponent(u);
    secret = decodeURIComponent(s ?? '');
  }
  const client = id ? getClient(id) : undefined;
  if (!client) return null;
  if (client.secret_hash && !(secret && safeEq(sha(secret), client.secret_hash))) return null;
  return client;
}

mcpAuth.post('/mcp-auth/token', async (c) => {
  const body = await readBody(c);
  const client = authClient(c, body);
  if (!client) return oauthError(c, 'invalid_client', 'Клиент не найден или неверный секрет', 401);

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.code_verifier) return oauthError(c, 'invalid_request', 'Нужны code и code_verifier');
    const row = db.prepare('SELECT * FROM oauth_codes WHERE hash = ?').get(sha(body.code)) as
      | { client_id: string; redirect_uri: string; challenge: string; scope: string | null; expires_at: string }
      | undefined;
    // код одноразовый — удаляем сразу
    db.prepare('DELETE FROM oauth_codes WHERE hash = ?').run(sha(body.code));
    if (!row || row.expires_at < now() || row.client_id !== client.id) return oauthError(c, 'invalid_grant', 'Код недействителен или истёк');
    if (body.redirect_uri && body.redirect_uri !== row.redirect_uri) return oauthError(c, 'invalid_grant', 'redirect_uri не совпадает');
    const challenge = createHash('sha256').update(body.code_verifier).digest('base64url');
    if (!safeEq(challenge, row.challenge)) return oauthError(c, 'invalid_grant', 'PKCE: code_verifier не подходит');
    return c.json(issueTokens(client.id, row.scope), 200, { 'Cache-Control': 'no-store' });
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) return oauthError(c, 'invalid_request', 'Нужен refresh_token');
    const h = sha(body.refresh_token);
    const row = db.prepare(`SELECT client_id, scope, expires_at FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'`).get(h) as
      | { client_id: string; scope: string | null; expires_at: string }
      | undefined;
    if (!row || row.expires_at < now() || row.client_id !== client.id) return oauthError(c, 'invalid_grant', 'refresh_token недействителен');
    db.prepare('DELETE FROM oauth_tokens WHERE hash = ?').run(h); // ротация
    return c.json(issueTokens(client.id, row.scope), 200, { 'Cache-Control': 'no-store' });
  }

  return oauthError(c, 'unsupported_grant_type', `grant_type ${body.grant_type} не поддерживается`);
});

mcpAuth.post('/mcp-auth/revoke', async (c) => {
  const body = await readBody(c);
  if (body.token) db.prepare('DELETE FROM oauth_tokens WHERE hash = ?').run(sha(body.token));
  return c.body(null, 200);
});
