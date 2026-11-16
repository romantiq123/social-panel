import { db, log, now, uid } from './db.ts';
import { getChannel, listChannels } from './channels.ts';
import { getMedia, mediaUrl } from './media.ts';
import { getProvider } from './providers/index.ts';
import { getSettings } from './settings.ts';
import { localParts, zonedToUtc } from './time.ts';
import type { ChannelRow, MediaRef, PostOptions, PostRow, PostStatus } from './types.ts';

export interface PostView extends Omit<PostRow, 'media' | 'options' | 'insights'> {
  media: (MediaRef & { url: string })[];
  options: PostOptions;
  insights: Record<string, number> | null;
  channel: { id: string; provider: string; username: string; avatar_url: string | null } | null;
}

const EMOJI = /\p{Extended_Pictographic}/u;

/** Threads считает эмодзи по количеству UTF-8 байт */
export function textLength(text: string, provider: string) {
  if (provider !== 'threads') return [...text].length;
  let n = 0;
  for (const ch of text) n += EMOJI.test(ch) ? Buffer.byteLength(ch) : 1;
  return n;
}

export function validatePost(provider: string, content: string, media: MediaRef[], options: PostOptions): string[] {
  const errors: string[] = [];
  const p = getProvider(provider);
  const len = textLength(content, provider);
  if (len > p.limits.text) errors.push(`${p.label}: текст ${len}/${p.limits.text} символов`);
  if (media.length > p.limits.media) errors.push(`${p.label}: максимум ${p.limits.media} медиа`);

  if (provider === 'threads') {
    if (!content.trim() && media.length === 0) errors.push('Threads: пустой пост — нужен текст или медиа');
    const tag = options.threads?.topic_tag;
    if (tag && /[.&]/.test(tag)) errors.push('Threads: тема не может содержать «.» и «&»');
    for (const [i, part] of (options.threads?.thread ?? []).entries()) {
      const l = textLength(part.text ?? '', 'threads');
      if (l > 500) errors.push(`Threads: часть цепочки #${i + 2} — ${l}/500 символов`);
      if ((part.media?.length ?? 0) > 20) errors.push(`Threads: часть #${i + 2} — максимум 20 медиа`);
    }
  }
  if (provider === 'instagram') {
    const type = options.instagram?.type ?? 'feed';
    if (media.length === 0) errors.push('Instagram: нужно хотя бы одно фото или видео');
    if (type === 'story' && media.length > 1) errors.push('Instagram Stories: только одно медиа');
    if (type === 'reel' && !media.some((m) => m.kind === 'video')) errors.push('Instagram Reels: нужно видео');
    const tags = content.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    if (tags > 30) errors.push(`Instagram: ${tags}/30 хэштегов`);
    const mentions = content.match(/@[\w.]+/g)?.length ?? 0;
    if (mentions > 20) errors.push(`Instagram: ${mentions}/20 упоминаний`);
  }
  return errors;
}

async function view(r: PostRow, channels?: Map<string, ChannelRow>, mediaMap?: Map<string, { filename: string }>): Promise<PostView> {
  const ch = channels ? channels.get(r.channel_id) : ((await db.prepare('SELECT * FROM channels WHERE id=?').get(r.channel_id)) as ChannelRow | undefined);
  const media: (MediaRef & { url: string })[] = [];
  for (const m of JSON.parse(r.media) as MediaRef[]) {
    try {
      const f = mediaMap ? mediaMap.get(m.id) : await getMedia(m.id);
      media.push({ ...m, url: f ? mediaUrl(f) : '' });
    } catch {
      media.push({ ...m, url: '' });
    }
  }
  return {
    ...r,
    media,
    options: JSON.parse(r.options),
    insights: r.insights ? JSON.parse(r.insights) : null,
    channel: ch ? { id: ch.id, provider: ch.provider, username: ch.username, avatar_url: ch.avatar_url } : null,
  };
}

export async function getPost(id: string): Promise<PostView> {
  const r = await db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as unknown as PostRow | undefined;
  if (!r) throw new Error(`Пост не найден: ${id}`);
  return view(r);
}

export async function listPosts(f: { from?: string; to?: string; status?: string; channel_id?: string; limit?: number } = {}): Promise<PostView[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.from) {
    where.push('COALESCE(published_at, scheduled_at, created_at) >= ?');
    args.push(f.from);
  }
  if (f.to) {
    where.push('COALESCE(published_at, scheduled_at, created_at) < ?');
    args.push(f.to);
  }
  if (f.status) {
    const st = f.status.split(',');
    where.push(`status IN (${st.map(() => '?').join(',')})`);
    args.push(...st);
  }
  if (f.channel_id) {
    where.push('channel_id = ?');
    args.push(f.channel_id);
  }
  const sql = `SELECT * FROM posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(published_at, scheduled_at, updated_at) DESC LIMIT ?`;
  args.push(f.limit ?? 500);
  const rows = await db.prepare(sql).all(...args) as unknown as PostRow[];
  const chMap = new Map((await listChannels()).map((c) => [c.id, c]));
  const mediaMap = new Map(((await db.prepare('SELECT id, filename FROM media').all()) as { id: string; filename: string }[]).map((m) => [m.id, m]));
  return Promise.all(rows.map((r) => view(r, chMap, mediaMap)));
}

export interface PostInput {
  channel_ids: string[];
  content: string;
  /** Индивидуальный текст для конкретного канала */
  overrides?: Record<string, string>;
  media?: string[];
  options?: PostOptions;
  scheduled_at?: string | null;
  status?: 'draft' | 'scheduled';
}

export async function createPosts(input: PostInput): Promise<PostView[]> {
  if (!input.channel_ids?.length) throw new Error('Выберите хотя бы один канал');
  const channels: ChannelRow[] = [];
  for (const id of input.channel_ids) channels.push(await getChannel(id));
  const refs: MediaRef[] = [];
  for (const id of input.media ?? []) {
    const m = await getMedia(id);
    refs.push({ id: m.id, kind: m.kind });
  }
  const status = input.status ?? (input.scheduled_at ? 'scheduled' : 'draft');
  if (status === 'scheduled' && !input.scheduled_at) throw new Error('Для планирования нужна дата scheduled_at');

  const errors: string[] = [];
  for (const c of channels) {
    const text = input.overrides?.[c.id] ?? input.content;
    if (status === 'scheduled') errors.push(...validatePost(c.provider, text, refs, input.options ?? {}).map((e) => `@${c.username} — ${e}`));
  }
  if (errors.length) throw new Error(errors.join('\n'));

  const group = uid();
  const ts = now();
  const ids: string[] = [];
  for (const c of channels) {
      const id = uid();
      await db.prepare(
        `INSERT INTO posts (id, group_id, channel_id, status, content, media, options, scheduled_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        group,
        c.id,
        status,
        input.overrides?.[c.id] ?? input.content,
        JSON.stringify(refs),
        JSON.stringify(input.options ?? {}),
        input.scheduled_at ?? null,
        ts,
        ts,
      );
      ids.push(id);
  }
  await log('info', 'posts', `Создано постов: ${ids.length} (${status})`);
  return Promise.all(ids.map((id) => getPost(id)));
}

export interface PostPatch {
  content?: string;
  media?: string[];
  options?: PostOptions;
  scheduled_at?: string | null;
  status?: 'draft' | 'scheduled';
  channel_id?: string;
}

export async function updatePost(id: string, patch: PostPatch): Promise<PostView> {
  const cur = await getPost(id);
  if (cur.status === 'published' || cur.status === 'publishing') throw new Error('Опубликованный пост нельзя редактировать');
  const channel = await getChannel(patch.channel_id ?? cur.channel_id);
  const content = patch.content ?? cur.content;
  const refs: MediaRef[] = [];
  if (patch.media) for (const mid of patch.media) refs.push({ id: mid, kind: (await getMedia(mid)).kind });
  else refs.push(...cur.media.map(({ id, kind }) => ({ id, kind })));
  const options = patch.options ?? cur.options;
  const scheduled_at = patch.scheduled_at !== undefined ? patch.scheduled_at : cur.scheduled_at;
  let status: PostStatus = patch.status ?? (cur.status === 'failed' ? 'draft' : cur.status);
  if (status === 'scheduled') {
    if (!scheduled_at) throw new Error('Для планирования нужна дата');
    const errs = validatePost(channel.provider, content, refs, options);
    if (errs.length) throw new Error(errs.join('\n'));
  }
  await db.prepare(
    `UPDATE posts SET channel_id=?, content=?, media=?, options=?, scheduled_at=?, status=?, error=NULL, attempts=0, updated_at=? WHERE id=?`,
  ).run(channel.id, content, JSON.stringify(refs), JSON.stringify(options), scheduled_at, status, now(), id);
  return getPost(id);
}

/**
 * Удаляет пост из панели. С remote=true сначала удаляет публикацию в самой соцсети
 * (Threads — да; Instagram API этого не умеет). Части цепочки Threads остаются ответами — их удаляйте отдельно.
 */
export async function deletePost(id: string, opts: { remote?: boolean } = {}) {
  const p = await getPost(id);
  if (p.status === 'publishing') throw new Error('Пост сейчас публикуется');
  if (opts.remote) {
    if (p.status !== 'published' || !p.external_id) throw new Error('Пост ещё не опубликован — удалять в соцсети нечего');
    const c = await getChannel(p.channel_id);
    await getProvider(c.provider).deleteRemote(c, p.external_id);
    await log('info', 'posts', `Публикация удалена из ${c.provider} @${c.username}: ${p.permalink ?? p.external_id}`, { channel_id: c.id });
  }
  await db.prepare('DELETE FROM posts WHERE id=?').run(id);
}

/* --------------------------------- Ответы --------------------------------- */

async function publishedRef(id: string) {
  const p = await getPost(id);
  if (p.status !== 'published' || !p.external_id) throw new Error('Ответы есть только у опубликованных постов');
  return { post: p, channel: await getChannel(p.channel_id) };
}

export async function listReplies(postId: string) {
  const { post, channel } = await publishedRef(postId);
  return getProvider(channel.provider).listReplies(channel, post.external_id!);
}

export async function replyTo(postId: string, text: string, replyId?: string) {
  if (!text.trim()) throw new Error('Пустой ответ');
  const { post, channel } = await publishedRef(postId);
  const limit = channel.provider === 'threads' ? 500 : 2200;
  if (textLength(text, channel.provider) > limit) throw new Error(`Ответ длиннее ${limit} символов`);
  const id = await getProvider(channel.provider).reply(channel, { postId: post.external_id!, replyId }, text);
  await log('info', 'replies', `Ответ от @${channel.username} опубликован`, { post_id: postId, channel_id: channel.id });
  return id;
}

export async function hideReply(postId: string, replyId: string, hide = true) {
  const { channel } = await publishedRef(postId);
  await getProvider(channel.provider).hideReply(channel, replyId, hide);
}

export async function duplicatePost(id: string): Promise<PostView> {
  const p = await getPost(id);
  const nid = uid();
  const ts = now();
  await db.prepare(
    `INSERT INTO posts (id, group_id, channel_id, status, content, media, options, created_at, updated_at) VALUES (?,?,?,'draft',?,?,?,?,?)`,
  ).run(nid, uid(), p.channel_id, p.content, JSON.stringify(p.media.map(({ id, kind }) => ({ id, kind }))), JSON.stringify(p.options), ts, ts);
  return getPost(nid);
}

/** Ближайший свободный слот из расписания канала (как «Add to queue» в Postiz) */
export async function nextFreeSlot(channelId: string, after = Date.now() + 5 * 60_000): Promise<string> {
  const c = await getChannel(channelId);
  const tz = getSettings().timezone;
  const slots = (JSON.parse(c.time_slots) as string[]).sort();
  if (!slots.length) throw new Error('У канала не задано расписание (time slots)');
  const busy = ((await db.prepare(`SELECT scheduled_at FROM posts WHERE channel_id=? AND status IN ('scheduled','publishing') AND scheduled_at IS NOT NULL`).all(c.id)) as { scheduled_at: string }[]).map(
    (r) => Date.parse(r.scheduled_at),
  );
  for (let day = 0; day < 120; day++) {
    const { y, m, d } = localParts(after + day * 86_400_000, tz);
    for (const s of slots) {
      const [h, mi] = s.split(':').map(Number);
      const ts = zonedToUtc(y, m, d, h, mi, tz);
      if (ts <= after) continue;
      if (busy.some((b) => Math.abs(b - ts) < 30 * 60_000)) continue;
      return new Date(ts).toISOString();
    }
  }
  throw new Error('Не найден свободный слот в ближайшие 120 дней');
}

/* ------------------------------- Публикация ------------------------------- */

/** Атомарно «захватывает» пост, чтобы сервер и MCP не опубликовали его дважды */
async function claim(id: string, allowed: PostStatus[]): Promise<boolean> {
  const r = await db.prepare(`UPDATE posts SET status='publishing', updated_at=? WHERE id=? AND status IN (${allowed.map(() => '?').join(',')})`)
    .run(now(), id, ...allowed);
  return r.changes === 1;
}

const MAX_ATTEMPTS = 3;

export async function publishPost(id: string, opts: { force?: boolean } = {}): Promise<PostView> {
  const allowed: PostStatus[] = opts.force ? ['draft', 'scheduled', 'failed'] : ['scheduled'];
  if (!(await claim(id, allowed))) throw new Error('Пост уже публикуется или опубликован');
  const post = await getPost(id);
  const channel = await getChannel(post.channel_id);
  const provider = getProvider(channel.provider);
  const base = getSettings().public_base_url;

  try {
    if (!base || /localhost|127\.0\.0\.1/.test(base))
      throw Object.assign(new Error('PUBLIC_BASE_URL не задан или локальный — Meta не сможет скачать медиа. Настройки → Публичный URL'), { permanent: true });
    if (channel.status === 'expired') throw Object.assign(new Error('Токен канала истёк — переподключите канал'), { permanent: true });
    const errs = validatePost(channel.provider, post.content, post.media, post.options);
    if (errs.length) throw Object.assign(new Error(errs.join('; ')), { permanent: true });

    // провайдеры ждут синхронный resolveMedia — заранее подгружаем все файлы поста
    const allIds = new Set<string>(post.media.map((m) => m.id));
    for (const part of post.options.threads?.thread ?? []) for (const m of part.media ?? []) allIds.add(m.id);
    const files = new Map<string, Awaited<ReturnType<typeof getMedia>>>();
    for (const mid of allIds) files.set(mid, await getMedia(mid));
    const resolveMedia = (refs: MediaRef[]) =>
      refs.map((r) => {
        const m = files.get(r.id);
        if (!m) throw new Error(`Медиа не найдено: ${r.id}`);
        return { kind: m.kind, url: mediaUrl(m) };
      });

    const res = await provider.publish({
      channel,
      content: post.content,
      media: resolveMedia(post.media),
      options: post.options,
      resolveMedia,
    });
    await db.prepare(`UPDATE posts SET status='published', published_at=?, external_id=?, permalink=?, error=?, updated_at=? WHERE id=?`).run(
      now(),
      res.external_id,
      res.permalink ?? null,
      res.warnings?.length ? res.warnings.join('\n') : null,
      now(),
      id,
    );
    await log('info', 'publish', `Опубликовано в ${provider.label} @${channel.username}: ${res.permalink ?? res.external_id}`, { post_id: id, channel_id: channel.id });
    for (const w of res.warnings ?? []) await log('warn', 'publish', w, { post_id: id, channel_id: channel.id });
  } catch (e: any) {
    const attempts = post.attempts + 1;
    const permanent = e.permanent || e.isPermanent || attempts >= MAX_ATTEMPTS || opts.force;
    if (e.isAuth) {
      await db.prepare(`UPDATE channels SET status='expired', last_error=? WHERE id=?`).run(e.message, channel.id);
    }
    if (permanent) {
      await db.prepare(`UPDATE posts SET status='failed', error=?, attempts=?, updated_at=? WHERE id=?`).run(e.message, attempts, now(), id);
    } else {
      // повтор через 2, 4 минуты
      const retryAt = new Date(Date.now() + attempts * 2 * 60_000).toISOString();
      await db.prepare(`UPDATE posts SET status='scheduled', error=?, attempts=?, scheduled_at=?, updated_at=? WHERE id=?`).run(e.message, attempts, retryAt, now(), id);
    }
    await log('error', 'publish', `@${channel.username}: ${e.message}${permanent ? '' : ` (повтор ${attempts}/${MAX_ATTEMPTS})`}`, { post_id: id, channel_id: channel.id });
  }
  return getPost(id);
}

export async function publishDue() {
  const due = (await db.prepare(`SELECT id FROM posts WHERE status='scheduled' AND scheduled_at <= ? ORDER BY scheduled_at`).all(now())) as { id: string }[];
  for (const { id } of due) {
    try {
      await publishPost(id);
    } catch {
      /* уже захвачен другим процессом */
    }
  }
  return due.length;
}

/** Если процесс упал во время публикации — пост мог зависнуть в publishing */
export async function recoverStuck() {
  const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();
  const r = await db.prepare(`UPDATE posts SET status='failed', error='Публикация прервана (перезапуск сервера). Проверьте аккаунт перед повтором.' WHERE status='publishing' AND updated_at < ?`)
    .run(cutoff);
  if (r.changes) await log('warn', 'publish', `Помечено зависших публикаций: ${r.changes}`);
}

/* -------------------------------- Статистика -------------------------------- */

export async function refreshInsights(id: string) {
  const p = await getPost(id);
  if (p.status !== 'published' || !p.external_id) throw new Error('Статистика доступна только для опубликованных постов');
  const c = await getChannel(p.channel_id);
  const data = await getProvider(c.provider).insights(c, p.external_id, p.options);
  await db.prepare('UPDATE posts SET insights=?, insights_at=? WHERE id=?').run(JSON.stringify(data), now(), id);
  return getPost(id);
}

export async function refreshRecentInsights(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const stale = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const rows = await db.prepare(`SELECT id FROM posts WHERE status='published' AND published_at >= ? AND (insights_at IS NULL OR insights_at < ?)`)
    .all(since, stale) as { id: string }[];
  let ok = 0;
  for (const { id } of rows) {
    try {
      await refreshInsights(id);
      ok++;
    } catch (e: any) {
      await log('warn', 'insights', e.message, { post_id: id });
    }
  }
  return ok;
}

export async function statsSummary(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await db.prepare(`SELECT * FROM posts WHERE status='published' AND published_at >= ?`).all(since) as unknown as PostRow[];
  const byChannel: Record<string, { posts: number; totals: Record<string, number> }> = {};
  for (const r of rows) {
    const b = (byChannel[r.channel_id] ??= { posts: 0, totals: {} });
    b.posts++;
    for (const [k, v] of Object.entries(r.insights ? (JSON.parse(r.insights) as Record<string, number>) : {})) b.totals[k] = (b.totals[k] ?? 0) + (v ?? 0);
  }
  const counts = (await db.prepare(`SELECT status, COUNT(*)::int as n FROM posts GROUP BY status`).all()) as { status: string; n: number }[];
  return { days, byChannel, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}
