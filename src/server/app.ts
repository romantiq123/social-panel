import '../core/paths.ts';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { basename } from 'node:path';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

import { db, ensureSchema, log } from '../core/db.ts';
import { getSettings, loadSettings, publicSettings, updateSettings, SECRET_KEYS } from '../core/settings.ts';
import { publicFileUrl } from '../core/storage.ts';
import {
  connectWithCode,
  connectWithToken,
  deleteChannel,
  getChannel,
  listChannels,
  publicChannel,
  refreshChannelToken,
  refreshDueTokens,
  updateChannel,
} from '../core/channels.ts';
import { createUploadUrl, deleteMedia, finalizeUpload, listMedia, mediaUsage, MediaInUseError, publicMedia, saveMedia } from '../core/media.ts';
import {
  createPosts,
  deletePost,
  hideReply,
  listReplies,
  replyTo,
  duplicatePost,
  getPost,
  listPosts,
  nextFreeSlot,
  publishPost,
  refreshInsights,
  refreshRecentInsights,
  statsSummary,
  updatePost,
  validatePost,
} from '../core/posts.ts';
import { getProvider } from '../core/providers/index.ts';
import { redirectUri } from '../core/providers/threads.ts';
import { tick } from '../core/scheduler.ts';
import { authMiddleware, checkBearer, checkPassword, clientIp, COOKIE, initAuth, mcpToken, recordFailure, rotateMcpToken, sign, startSession, tooManyAttempts } from './auth.ts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '../mcp/server.ts';
import { listClients, mcpAuth, revokeClient, verifyAccessToken, wwwAuthenticate } from './mcpAuth.ts';
import type { Provider } from '../core/types.ts';

export const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 400);
});

// Каждый запрос: схема (один раз на инстанс), свежие настройки из БД, пароль/секреты
app.use('*', async (c, next) => {
  await ensureSchema();
  await loadSettings();
  await initAuth();
  await next();
});

app.use('*', authMiddleware);

// OAuth 2.1 для Claude connectors: .well-known, /mcp-auth/*
app.route('/', mcpAuth);

/* ---------------------------------- Auth ---------------------------------- */

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/login', async (c) => {
  const ip = clientIp(c);
  if (tooManyAttempts(ip)) return c.json({ error: 'Слишком много попыток, подождите 15 минут' }, 429);
  const { password } = await c.req.json();
  if (!checkPassword(password)) {
    recordFailure(ip);
    return c.json({ error: 'Неверный пароль' }, 401);
  }
  startSession(c);
  return c.json({ ok: true });
});

app.post('/api/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/me', (c) => c.json({ ok: true }));

/* -------------------------------- Settings -------------------------------- */

app.get('/api/settings', (c) =>
  c.json({
    settings: publicSettings(),
    redirect_uris: { threads: redirectUri('threads'), instagram: redirectUri('instagram') },
    uninstall_uris: { threads: `${getSettings().public_base_url}/oauth/threads/deauthorize`, instagram: `${getSettings().public_base_url}/oauth/instagram/deauthorize` },
    project_root: process.cwd(),
    // На сервере (Vercel/Railway) локальный stdio-MCP бесполезен — UI его не показывает
    deployed: !!(process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production'),
  }),
);

app.put('/api/settings', async (c) => {
  const body = await c.req.json();
  // маскированные секреты не перезаписываем
  for (const k of SECRET_KEYS) if (typeof body[k] === 'string' && body[k].startsWith('••')) delete body[k];
  await updateSettings(body);
  return c.json({ settings: publicSettings() });
});

app.get('/api/signatures', async (c) => c.json(await db.prepare('SELECT * FROM signatures ORDER BY name').all()));
app.post('/api/signatures', async (c) => {
  const { name, content } = await c.req.json();
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO signatures (id, name, content, created_at) VALUES (?,?,?,?)').run(id, name, content, new Date().toISOString());
  return c.json({ id });
});
app.delete('/api/signatures/:id', async (c) => {
  await db.prepare('DELETE FROM signatures WHERE id=?').run(c.req.param('id'));
  return c.json({ ok: true });
});

/* -------------------------------- Channels -------------------------------- */

app.get('/api/channels', async (c) => c.json((await listChannels()).map(publicChannel)));

app.post('/api/channels/token', async (c) => {
  const { provider, token } = await c.req.json();
  const ch = await connectWithToken(provider as Provider, token);
  return c.json(publicChannel(ch));
});

app.post('/api/channels/refresh-all', async (c) => c.json(await refreshDueTokens()));

app.post('/api/channels/:id/refresh', async (c) => c.json(publicChannel(await refreshChannelToken(c.req.param('id')))));

app.patch('/api/channels/:id', async (c) => c.json(publicChannel(await updateChannel(c.req.param('id'), await c.req.json()))));

app.delete('/api/channels/:id', async (c) => {
  await deleteChannel(c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/api/channels/:id/limits', async (c) => {
  const ch = await getChannel(c.req.param('id'));
  return c.json(await getProvider(ch.provider).publishingLimit(ch));
});

app.get('/api/channels/:id/next-slot', async (c) => c.json({ at: await nextFreeSlot(c.req.param('id')) }));

/* ---------------------------------- OAuth --------------------------------- */

// state подписываем HMAC-ом: на serverless разные запросы попадают в разные инстансы, Map в памяти не годится
type OAuthState = { provider: Provider; at: number; back: string; n: string };
const packState = (s: OAuthState) => {
  const body = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${body}.${sign('oauth-state|' + body)}`;
};
function unpackState(state: string | undefined): OAuthState | undefined {
  if (!state) return;
  const [body, mac] = state.split('.');
  if (!body || !mac) return;
  const want = Buffer.from(sign('oauth-state|' + body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return;
  }
}

app.get('/oauth/:provider/start', (c) => {
  const provider = c.req.param('provider') as Provider;
  const base = getSettings().public_base_url;
  if (!base.startsWith('https://')) {
    return c.html(page('Нужен HTTPS', `Meta принимает только HTTPS redirect URI. Укажите публичный HTTPS-адрес (туннель) в «Настройках».`));
  }
  // вернём пользователя туда, откуда он начал (localhost или туннель)
  let back = '';
  try {
    back = new URL(c.req.header('referer') ?? '').origin;
  } catch {}
  const state = packState({ provider, at: Date.now(), back, n: randomBytes(8).toString('hex') });
  return c.redirect(getProvider(provider).authorizeUrl(state));
});

app.get('/oauth/:provider/callback', async (c) => {
  const provider = c.req.param('provider') as Provider;
  const { code, state, error_description, error } = c.req.query();
  const s = unpackState(state);
  if (error) return c.html(page('Ошибка авторизации', error_description ?? error));
  if (!s || s.provider !== provider || Date.now() - s.at > 15 * 60_000) return c.html(page('Ошибка', 'Неверный или просроченный state. Попробуйте ещё раз.'));
  try {
    // Instagram добавляет "#_" в конец кода
    const ch = await connectWithCode(provider, String(code).replace(/#_$/, ''));
    return c.redirect(`${s.back}/#/channels?connected=${encodeURIComponent(ch.username)}`);
  } catch (e: any) {
    return c.html(page('Не удалось подключить', e.message));
  }
});

// Meta требует URL для деавторизации/удаления данных — просто принимаем
app.post('/oauth/:provider/deauthorize', (c) => c.json({ ok: true }));
app.post('/oauth/:provider/delete', (c) => c.json({ url: getSettings().public_base_url, confirmation_code: randomBytes(6).toString('hex') }));

function page(title: string, msg: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
  <body style="font-family:system-ui;max-width:560px;margin:80px auto;padding:0 16px">
  <h2>${esc(title)}</h2><p>${esc(msg)}</p><a href="/#/channels">← Вернуться в панель</a></body>`;
}

/* ---------------------------------- Media --------------------------------- */

app.get('/api/media', async (c) => {
  const list = await listMedia();
  const out = [];
  for (const m of list) out.push({ ...publicMedia(m), used_in: (await mediaUsage(m.id)).length });
  return c.json(out);
});
app.get('/api/media/:id/usage', async (c) => c.json(await mediaUsage(c.req.param('id'))));

// Прямая загрузка в Storage: 1) получить подписанный URL, 2) PUT файла из браузера, 3) finalize
app.post('/api/media/upload-url', async (c) => {
  const { name } = await c.req.json();
  return c.json(await createUploadUrl(String(name ?? '')));
});
app.post('/api/media/finalize', async (c) => {
  const { path, name, type, size } = await c.req.json();
  return c.json(publicMedia(await finalizeUpload(String(path), String(name ?? 'file'), String(type ?? ''), Number(size ?? 0))));
});

app.post('/api/media', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = ([] as unknown[]).concat(body['file'] ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) throw new Error('Файл не передан');
  const out = [];
  for (const f of files) out.push(publicMedia(await saveMedia(Buffer.from(await f.arrayBuffer()), f.name, f.type)));
  return c.json(out);
});

app.delete('/api/media/:id', async (c) => {
  try {
    await deleteMedia(c.req.param('id'), { force: c.req.query('force') === '1' });
  } catch (e) {
    if (e instanceof MediaInUseError) return c.json({ error: e.message, usage: e.usage }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

// Старые ссылки /media/<file> → публичный URL в Supabase Storage
app.get('/media/:file', (c) => c.redirect(publicFileUrl(basename(c.req.param('file'))), 302));

/* ---------------------------------- Posts --------------------------------- */

app.get('/api/posts', async (c) => {
  const q = c.req.query();
  return c.json(await listPosts({ from: q.from, to: q.to, status: q.status, channel_id: q.channel_id, limit: q.limit ? Number(q.limit) : undefined }));
});

app.post('/api/posts', async (c) => {
  const body = await c.req.json();
  const posts = await createPosts(body);
  if (body.publish_now) {
    const out = [];
    for (const p of posts) out.push(await publishPost(p.id, { force: true }));
    return c.json(out);
  }
  return c.json(posts);
});

app.post('/api/posts/validate', async (c) => {
  const { provider, content, media, options } = await c.req.json();
  return c.json({ errors: validatePost(provider, content ?? '', media ?? [], options ?? {}) });
});

app.get('/api/posts/:id', async (c) => c.json(await getPost(c.req.param('id'))));
app.put('/api/posts/:id', async (c) => c.json(await updatePost(c.req.param('id'), await c.req.json())));
app.delete('/api/posts/:id', async (c) => {
  await deletePost(c.req.param('id'), { remote: c.req.query('remote') === '1' });
  return c.json({ ok: true });
});
app.get('/api/posts/:id/replies', async (c) => c.json(await listReplies(c.req.param('id'))));
app.post('/api/posts/:id/replies', async (c) => {
  const { text, reply_id } = await c.req.json();
  return c.json({ id: await replyTo(c.req.param('id'), text, reply_id) });
});
app.post('/api/posts/:id/replies/:rid/hide', async (c) => {
  const { hide } = await c.req.json().catch(() => ({ hide: true }));
  await hideReply(c.req.param('id'), c.req.param('rid'), hide !== false);
  return c.json({ ok: true });
});
app.post('/api/posts/:id/publish', async (c) => c.json(await publishPost(c.req.param('id'), { force: true })));
app.post('/api/posts/:id/duplicate', async (c) => c.json(await duplicatePost(c.req.param('id'))));
app.post('/api/posts/:id/insights', async (c) => c.json(await refreshInsights(c.req.param('id'))));

/* -------------------------------- Analytics ------------------------------- */

app.get('/api/stats', async (c) => c.json(await statsSummary(Number(c.req.query('days') ?? 30))));
app.post('/api/stats/refresh', async (c) => c.json({ updated: await refreshRecentInsights(Number(c.req.query('days') ?? 30)) }));

app.get('/api/logs', async (c) => c.json(await db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(Number(c.req.query('limit') ?? 200))));

/* ------------------------------- Remote MCP ------------------------------- */

app.get('/api/mcp-token', (c) => c.json({ token: mcpToken(), from_env: !!process.env.MCP_TOKEN }));
app.post('/api/mcp-token/rotate', async (c) => {
  if (process.env.MCP_TOKEN) throw new Error('Токен задан через переменную MCP_TOKEN — меняйте его там');
  return c.json({ token: await rotateMcpToken() });
});

app.get('/api/mcp-clients', async (c) => c.json(await listClients()));
app.delete('/api/mcp-clients/:id', async (c) => {
  await revokeClient(c.req.param('id'));
  return c.json({ ok: true });
});

// Streamable HTTP, без сессий: на каждый запрос — свой сервер и транспорт
app.all('/mcp', async (c) => {
  const auth = c.req.header('authorization');
  if (!checkBearer(auth) && !(await verifyAccessToken(auth))) {
    return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': wwwAuthenticate(c, !!auth) });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMcpServer();
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    // ответ уже сформирован целиком (enableJsonResponse) — можно закрывать
    queueMicrotask(() => server.close().catch(() => {}));
  }
});

/* ---------------------------------- Cron ---------------------------------- */

// Раз в минуту дёргается pg_cron из Supabase (или Vercel Cron). Публичный: тик лишь выполняет то, что уже пора.
let ticking = false;
app.on(['GET', 'POST'], '/api/cron/tick', async (c) => {
  if (ticking) return c.json({ ok: true, skipped: true });
  ticking = true;
  try {
    await tick();
  } finally {
    ticking = false;
  }
  return c.json({ ok: true });
});

export default app;
