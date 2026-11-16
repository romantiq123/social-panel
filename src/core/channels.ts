import { db, log, now, uid } from './db.ts';
import { getProvider } from './providers/index.ts';
import { GraphError } from './providers/graph.ts';
import { getSettings } from './settings.ts';
import type { ChannelRow, Provider, TokenInfo } from './types.ts';

const DAY = 86_400_000;

export async function listChannels(): Promise<ChannelRow[]> {
  return await db.prepare('SELECT * FROM channels ORDER BY provider, username').all() as unknown as ChannelRow[];
}

export async function getChannel(id: string): Promise<ChannelRow> {
  const c = await db.prepare('SELECT * FROM channels WHERE id = ? OR username = ?').get(id, id.replace(/^@/, '')) as unknown as ChannelRow | undefined;
  if (!c) throw new Error(`Канал не найден: ${id}`);
  return c;
}

/** Без токена — для UI и MCP */
export function publicChannel(c: ChannelRow) {
  const { access_token, ...rest } = c;
  const expiresIn = c.token_expires_at ? Math.round((Date.parse(c.token_expires_at) - Date.now()) / DAY) : null;
  return { ...rest, time_slots: JSON.parse(c.time_slots) as string[], token_days_left: expiresIn, token_preview: '…' + access_token.slice(-6) };
}

const expiresAt = (t: TokenInfo) => (t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : new Date(Date.now() + 60 * DAY).toISOString());

/** Сохраняет/обновляет канал по долгоживущему токену */
export async function upsertChannel(provider: Provider, longLived: TokenInfo) {
  const p = getProvider(provider);
  const prof = await p.profile(longLived.access_token);
  const existing = (await db.prepare('SELECT id FROM channels WHERE provider = ? AND external_id = ?').get(provider, prof.external_id)) as { id: string } | undefined;
  const id = existing?.id ?? uid();
  const ts = now();
  if (existing) {
    await db.prepare(
      `UPDATE channels SET username=?, name=?, avatar_url=?, access_token=?, token_expires_at=?, token_refreshed_at=?, status='active', last_error=NULL, followers_count=? WHERE id=?`,
    ).run(prof.username, prof.name ?? null, prof.avatar_url ?? null, longLived.access_token, expiresAt(longLived), ts, prof.followers_count ?? null, id);
  } else {
    await db.prepare(
      `INSERT INTO channels (id, provider, external_id, username, name, avatar_url, access_token, token_expires_at, token_refreshed_at, status, followers_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`,
    ).run(id, provider, prof.external_id, prof.username, prof.name ?? null, prof.avatar_url ?? null, longLived.access_token, expiresAt(longLived), ts, prof.followers_count ?? null, ts);
  }
  await log('info', 'channels', `${p.label} @${prof.username} ${existing ? 'переподключён' : 'подключён'}`, { channel_id: id });
  return getChannel(id);
}

/** OAuth-код → короткий токен → долгоживущий → канал */
export async function connectWithCode(provider: Provider, code: string) {
  const p = getProvider(provider);
  const short = await p.exchangeCode(code);
  const long = await p.toLongLived(short.access_token);
  return upsertChannel(provider, long);
}

/**
 * Подключение вставленным токеном (например из кабинета Meta for Developers).
 * Короткий токен обмениваем на долгоживущий; если он уже долгоживущий — обмен упадёт, тогда используем как есть.
 */
export async function connectWithToken(provider: Provider, token: string) {
  const p = getProvider(provider);
  token = token.trim();
  let info: TokenInfo = { access_token: token };
  try {
    info = await p.toLongLived(token);
  } catch {
    try {
      info = await p.refresh(token);
    } catch {
      /* используем как есть */
    }
  }
  return upsertChannel(provider, info);
}

export async function refreshChannelToken(id: string) {
  const c = await getChannel(id);
  const p = getProvider(c.provider);
  try {
    const t = await p.refresh(c.access_token);
    await db.prepare(`UPDATE channels SET access_token=?, token_expires_at=?, token_refreshed_at=?, status='active', last_error=NULL WHERE id=?`).run(
      t.access_token,
      expiresAt(t),
      now(),
      c.id,
    );
    // заодно обновим аватар/подписчиков
    try {
      const prof = await p.profile(t.access_token);
      await db.prepare('UPDATE channels SET username=?, name=?, avatar_url=?, followers_count=? WHERE id=?').run(
        prof.username,
        prof.name ?? null,
        prof.avatar_url ?? null,
        prof.followers_count ?? null,
        c.id,
      );
    } catch {}
    await log('info', 'tokens', `Токен @${c.username} (${p.label}) обновлён`, { channel_id: c.id });
    return getChannel(id);
  } catch (e: any) {
    await markChannelError(c, e);
    throw e;
  }
}

export async function markChannelError(c: ChannelRow, e: any) {
  const expired = e instanceof GraphError && e.isAuth;
  await db.prepare('UPDATE channels SET status=?, last_error=? WHERE id=?').run(expired ? 'expired' : 'error', String(e.message ?? e), c.id);
  await log('error', 'channels', `@${c.username}: ${e.message ?? e}`, { channel_id: c.id });
}

/**
 * Обновляет токены, которым осталось меньше N дней.
 * Meta разрешает refresh только если токену ≥ 24 часов — это учитываем.
 */
export async function refreshDueTokens() {
  const { refresh_days_before } = getSettings();
  const results: { username: string; ok: boolean; error?: string }[] = [];
  for (const c of await listChannels()) {
    if (c.status === 'expired') continue;
    const left = c.token_expires_at ? Date.parse(c.token_expires_at) - Date.now() : 0;
    const age = c.token_refreshed_at ? Date.now() - Date.parse(c.token_refreshed_at) : Infinity;
    if (left > refresh_days_before * DAY || age < DAY) continue;
    try {
      await refreshChannelToken(c.id);
      results.push({ username: c.username, ok: true });
    } catch (e: any) {
      results.push({ username: c.username, ok: false, error: e.message });
    }
  }
  return results;
}

export async function updateChannel(id: string, patch: { time_slots?: string[] }) {
  if (patch.time_slots) {
    const slots = [...new Set(patch.time_slots.filter((s) => /^\d{2}:\d{2}$/.test(s)))].sort();
    await db.prepare('UPDATE channels SET time_slots=? WHERE id=?').run(JSON.stringify(slots), id);
  }
  return getChannel(id);
}

export async function deleteChannel(id: string) {
  const c = await getChannel(id);
  await db.prepare('DELETE FROM channels WHERE id=?').run(c.id);
  await log('info', 'channels', `Канал @${c.username} (${c.provider}) удалён`);
}
