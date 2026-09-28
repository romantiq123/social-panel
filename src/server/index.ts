import '../core/paths.ts';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { deleteCookie } from 'hono/cookie';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

import { ROOT } from '../core/paths.ts';
import { db, UPLOAD_DIR } from '../core/db.ts';
import { getSettings, publicSettings, updateSettings, SECRET_KEYS } from '../core/settings.ts';
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
import { deleteMedia, listMedia, publicMedia, saveMedia } from '../core/media.ts';
import {
  createPosts,
  deletePost,
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
import { startScheduler } from '../core/scheduler.ts';
import { authMiddleware, checkBearer, checkPassword, clientIp, COOKIE, ensurePassword, mcpToken, recordFailure, startSession, tooManyAttempts } from './auth.ts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '../mcp/server.ts';
import { listClients, mcpAuth, revokeClient, verifyAccessToken, wwwAuthenticate } from './mcpAuth.ts';
import type { Provider } from '../core/types.ts';

const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 400);
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
    project_root: ROOT,
    // На сервере (Railway/Docker) локальный stdio-MCP бесполезен — UI его не показывает
    deployed: !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.NODE_ENV === 'production'),
  }),
);

app.put('/api/settings', async (c) => {
  const body = await c.req.json();
  // маскированные секреты не перезаписываем
  for (const k of SECRET_KEYS) if (typeof body[k] === 'string' && body[k].startsWith('••')) delete body[k];
  updateSettings(body);
  return c.json({ settings: publicSettings() });
});

app.get('/api/signatures', (c) => c.json(db.prepare('SELECT * FROM signatures ORDER BY name').all()));
app.post('/api/signatures', async (c) => {
  const { name, content } = await c.req.json();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO signatures (id, name, content, created_at) VALUES (?,?,?,?)').run(id, name, content, new Date().toISOString());
  return c.json({ id });
});
app.delete('/api/signatures/:id', (c) => {
  db.prepare('DELETE FROM signatures WHERE id=?').run(c.req.param('id'));
  return c.json({ ok: true });
});

/* -------------------------------- Channels -------------------------------- */

app.get('/api/channels', (c) => c.json(listChannels().map(publicChannel)));

app.post('/api/channels/token', async (c) => {
  const { provider, token } = await c.req.json();
  const ch = await connectWithToken(provider as Provider, token);
  return c.json(publicChannel(ch));
});

app.post('/api/channels/refresh-all', async (c) => c.json(await refreshDueTokens()));

app.post('/api/channels/:id/refresh', async (c) => c.json(publicChannel(await refreshChannelToken(c.req.param('id')))));

app.patch('/api/channels/:id', async (c) => c.json(publicChannel(updateChannel(c.req.param('id'), await c.req.json()))));

app.delete('/api/channels/:id', (c) => {
  deleteChannel(c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/api/channels/:id/limits', async (c) => {
  const ch = getChannel(c.req.param('id'));
  return c.json(await getProvider(ch.provider).publishingLimit(ch));
});

app.get('/api/channels/:id/next-slot', (c) => c.json({ at: nextFreeSlot(c.req.param('id')) }));

/* ---------------------------------- OAuth --------------------------------- */

const oauthStates = new Map<string, { provider: Provider; at: number; back: string }>();

app.get('/oauth/:provider/start', (c) => {
  const provider = c.req.param('provider') as Provider;
  const base = getSettings().public_base_url;
  if (!base.startsWith('https://')) {
    return c.html(page('Нужен HTTPS', `Meta принимает только HTTPS redirect URI. Укажите публичный HTTPS-адрес (туннель) в «Настройках».`));
  }
  const state = randomBytes(16).toString('hex');
  // вернём пользователя туда, откуда он начал (localhost или туннель)
  let back = '';
  try {
    back = new URL(c.req.header('referer') ?? '').origin;
  } catch {}
  oauthStates.set(state, { provider, at: Date.now(), back });
  return c.redirect(getProvider(provider).authorizeUrl(state));
});

app.get('/oauth/:provider/callback', async (c) => {
  const provider = c.req.param('provider') as Provider;
  const { code, state, error_description, error } = c.req.query();
  const s = state ? oauthStates.get(state) : undefined;
  if (error) return c.html(page('Ошибка авторизации', error_description ?? error));
  if (!s || s.provider !== provider || Date.now() - s.at > 15 * 60_000) return c.html(page('Ошибка', 'Неверный или просроченный state. Попробуйте ещё раз.'));
  oauthStates.delete(state!);
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

app.get('/api/media', (c) => c.json(listMedia().map(publicMedia)));

app.post('/api/media', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = ([] as unknown[]).concat(body['file'] ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) throw new Error('Файл не передан');
  const out = [];
  for (const f of files) out.push(publicMedia(await saveMedia(Buffer.from(await f.arrayBuffer()), f.name, f.type)));
  return c.json(out);
});

app.delete('/api/media/:id', async (c) => {
  await deleteMedia(c.req.param('id'));
  return c.json({ ok: true });
});

// Публичная раздача медиа — отсюда их забирают сервера Meta
app.get('/media/:file', (c) => {
  const file = basename(c.req.param('file'));
  const path = join(UPLOAD_DIR, file);
  if (!existsSync(path)) return c.notFound();
  const size = statSync(path).size;
  const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' }[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = c.req.header('range')?.match(/bytes=(\d*)-(\d*)/);
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers['Content-Length'] = String(size);
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
});

/* ---------------------------------- Posts --------------------------------- */

app.get('/api/posts', (c) => {
  const q = c.req.query();
  return c.json(listPosts({ from: q.from, to: q.to, status: q.status, channel_id: q.channel_id, limit: q.limit ? Number(q.limit) : undefined }));
});

app.post('/api/posts', async (c) => {
  const body = await c.req.json();
  const posts = createPosts(body);
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

app.get('/api/posts/:id', (c) => c.json(getPost(c.req.param('id'))));
app.put('/api/posts/:id', async (c) => c.json(updatePost(c.req.param('id'), await c.req.json())));
app.delete('/api/posts/:id', (c) => {
  deletePost(c.req.param('id'));
  return c.json({ ok: true });
});
app.post('/api/posts/:id/publish', async (c) => c.json(await publishPost(c.req.param('id'), { force: true })));
app.post('/api/posts/:id/duplicate', (c) => c.json(duplicatePost(c.req.param('id'))));
app.post('/api/posts/:id/insights', async (c) => c.json(await refreshInsights(c.req.param('id'))));

/* -------------------------------- Analytics ------------------------------- */

app.get('/api/stats', (c) => c.json(statsSummary(Number(c.req.query('days') ?? 30))));
app.post('/api/stats/refresh', async (c) => c.json({ updated: await refreshRecentInsights(Number(c.req.query('days') ?? 30)) }));

app.get('/api/logs', (c) => c.json(db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(Number(c.req.query('limit') ?? 200))));

/* ------------------------------- Remote MCP ------------------------------- */

app.get('/api/mcp-token', (c) => c.json({ token: mcpToken(), from_env: !!process.env.MCP_TOKEN }));
app.post('/api/mcp-token/rotate', (c) => {
  if (process.env.MCP_TOKEN) throw new Error('Токен задан через переменную MCP_TOKEN — меняйте его там');
  return c.json({ token: mcpToken(true) });
});

app.get('/api/mcp-clients', (c) => c.json(listClients()));
app.delete('/api/mcp-clients/:id', (c) => {
  revokeClient(c.req.param('id'));
  return c.json({ ok: true });
});

// Streamable HTTP, без сессий: на каждый запрос — свой сервер и транспорт
app.all('/mcp', async (c) => {
  const auth = c.req.header('authorization');
  if (!checkBearer(auth) && !verifyAccessToken(auth)) {
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

/* ------------------------------ Static (build) ----------------------------- */

const WEB = join(ROOT, 'dist', 'web');
app.get('*', async (c) => {
  if (!existsSync(WEB)) return c.text('UI не собран. Запустите `npm run build` или `npm run dev` (UI на :5173).', 404);
  const p = new URL(c.req.url).pathname;
  const file = join(WEB, p.replace(/\.\.+/g, ''));
  if (p !== '/' && existsSync(file) && statSync(file).isFile()) {
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon' };
    return new Response(await readFile(file), { headers: { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' } });
  }
  return c.html(await readFile(join(WEB, 'index.html'), 'utf8'));
});

/* ---------------------------------- Start --------------------------------- */

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => {
  console.error(`\n  Social Panel → http://localhost:${port}`);
  if (!process.env.PANEL_PASSWORD) console.error(`  Пароль панели: ${ensurePassword()}  (задайте PANEL_PASSWORD в .env, чтобы сменить)`);
  const base = getSettings().public_base_url;
  console.error(`  Публичный URL: ${base || '— не задан (Настройки)'}\n`);
  startScheduler();
});
