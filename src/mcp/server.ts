import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { db } from '../core/db.ts';
import { getSettings } from '../core/settings.ts';
import { listChannels, publicChannel, refreshChannelToken, refreshDueTokens, updateChannel } from '../core/channels.ts';
import { deleteMedia, importMedia, listMedia, mediaUsage, publicMedia } from '../core/media.ts';
import {
  createPosts,
  deletePost,
  duplicatePost,
  hideReply,
  listReplies,
  replyTo,
  getPost,
  listPosts,
  nextFreeSlot,
  publishPost,
  refreshInsights,
  statsSummary,
  updatePost,
  validatePost,
  type PostView,
} from '../core/posts.ts';
import { formatLocal, parseWhen } from '../core/time.ts';
import type { ChannelRow, MediaRef, PostOptions } from '../core/types.ts';

export function createMcpServer() {
const server = new McpServer(
  { name: 'social-panel', version: '0.1.0' },
  {
    instructions: `Панель управления Threads и Instagram (официальные API Meta).
Типичный сценарий: list_channels → (upload_media) → create_post (черновик) → пользователь смотрит → schedule_post / publish_now.
По умолчанию создавай ЧЕРНОВИКИ. Публикуй сразу (publish_now) только по явной просьбе пользователя — это необратимо.
Лимиты: Threads — 500 символов (эмодзи считаются по байтам), до 20 медиа, можно цепочку (thread). Instagram — подпись 2200, до 30 хэштегов, обязательно медиа, до 10 в карусели.
Время: ISO 8601 с оффсетом или "YYYY-MM-DD HH:mm" в часовом поясе панели (${getSettings().timezone}).`,
  },
);

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (e: any) => ({ content: [{ type: 'text' as const, text: `Ошибка: ${e?.message ?? e}` }], isError: true });
const run = <A,>(fn: (a: A) => unknown | Promise<unknown>) => async (a: A) => {
  try {
    return ok(await fn(a));
  } catch (e) {
    return fail(e);
  }
};

/** Канал по id, "threads:username", "@username" или "username" (если однозначно) */
function resolveChannel(ref: string): ChannelRow {
  const all = listChannels();
  const byId = all.find((c) => c.id === ref);
  if (byId) return byId;
  const m = ref.match(/^(threads|instagram|ig|th):@?(.+)$/i);
  if (m) {
    const provider = m[1].toLowerCase().startsWith('i') ? 'instagram' : 'threads';
    const c = all.find((x) => x.provider === provider && x.username.toLowerCase() === m[2].toLowerCase());
    if (c) return c;
  }
  const name = ref.replace(/^@/, '').toLowerCase();
  const matches = all.filter((c) => c.username.toLowerCase() === name);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`"${ref}" есть и в Threads, и в Instagram — укажите "threads:${name}" или "instagram:${name}"`);
  throw new Error(`Канал не найден: ${ref}. Доступные: ${all.map((c) => `${c.provider}:${c.username}`).join(', ') || 'нет'}`);
}

function brief(p: PostView) {
  return {
    id: p.id,
    channel: p.channel ? `${p.channel.provider}:@${p.channel.username}` : null,
    status: p.status,
    scheduled_at: p.scheduled_at,
    scheduled_local: formatLocal(p.scheduled_at),
    published_local: formatLocal(p.published_at),
    content: p.content,
    media: p.media.map((m) => ({ id: m.id, kind: m.kind })),
    options: p.options,
    permalink: p.permalink,
    error: p.error,
    insights: p.insights,
  };
}

const threadsOpts = z
  .object({
    topic_tag: z.string().optional().describe('Тема поста (без #, без точек и &)'),
    reply_control: z.enum(['everyone', 'accounts_you_follow', 'mentioned_only']).optional(),
    thread: z
      .array(z.object({ text: z.string(), media_ids: z.array(z.string()).optional() }))
      .optional()
      .describe('Продолжение цепочки: каждая часть — ответ на предыдущую (≤500 символов каждая)'),
  })
  .optional();

const igOpts = z
  .object({
    type: z.enum(['feed', 'reel', 'story']).optional().describe('feed — фото/карусель; reel — видео; story — сторис'),
    first_comment: z.string().optional().describe('Первый комментарий, например хэштеги'),
    share_to_feed: z.boolean().optional(),
  })
  .optional();

function buildOptions(threads?: z.infer<typeof threadsOpts>, instagram?: z.infer<typeof igOpts>, base: PostOptions = {}): PostOptions {
  const out: PostOptions = { ...base };
  if (threads) {
    const { thread, ...rest } = threads;
    out.threads = {
      ...base.threads,
      ...rest,
      ...(thread && {
        thread: thread.map((t) => ({
          text: t.text,
          media: (t.media_ids ?? []).map((id): MediaRef => {
            const row = db.prepare('SELECT id, kind, filename FROM media WHERE id=?').get(id) as (MediaRef & { filename: string }) | undefined;
            if (!row) throw new Error(`Медиа не найдено: ${id}`);
            return { id: row.id, kind: row.kind, url: `/media/${row.filename}` } as MediaRef;
          }),
        })),
      }),
    };
  }
  if (instagram) out.instagram = { ...base.instagram, ...instagram };
  return out;
}

/* --------------------------------- Tools --------------------------------- */

server.registerTool(
  'status',
  { title: 'Статус панели', description: 'Проверка настроек: публичный URL, ключи приложений, часовой пояс, статистика постов.' },
  run(() => {
    const s = getSettings();
    return {
      public_base_url: s.public_base_url || null,
      public_url_ok: /^https:\/\//.test(s.public_base_url),
      threads_app_configured: !!(s.threads_app_id && s.threads_app_secret),
      instagram_app_configured: !!(s.instagram_app_id && s.instagram_app_secret),
      timezone: s.timezone,
      now_local: formatLocal(new Date().toISOString()),
      channels: listChannels().length,
      posts: statsSummary().counts,
      note: 'Публикация по расписанию выполняется сервером панели (npm start) — он должен быть запущен.',
    };
  }),
);

server.registerTool(
  'list_channels',
  { title: 'Каналы', description: 'Подключённые аккаунты Threads/Instagram, статус токена и дни до его истечения.' },
  run(() =>
    listChannels().map((c) => {
      const p = publicChannel(c);
      return {
        id: p.id,
        ref: `${p.provider}:${p.username}`,
        name: p.name,
        status: p.status,
        token_days_left: p.token_days_left,
        followers: p.followers_count,
        time_slots: p.time_slots,
        last_error: p.last_error,
      };
    }),
  ),
);

server.registerTool(
  'upload_media',
  {
    title: 'Загрузить медиа',
    description: 'Добавляет фото/видео в библиотеку из URL или абсолютного локального пути. Картинки автоматически конвертируются в JPEG. Возвращает media id для create_post.',
    inputSchema: { source: z.string().describe('https://… или C:\\путь\\к\\файлу.jpg') },
  },
  run(async ({ source }: { source: string }) => {
    const m = await importMedia(source);
    return { id: m.id, kind: m.kind, width: m.width, height: m.height, size_kb: Math.round(m.size / 1024) };
  }),
);

server.registerTool(
  'list_media',
  { title: 'Библиотека медиа', description: 'Последние файлы в библиотеке.', inputSchema: { limit: z.number().int().optional() } },
  run(({ limit }: { limit?: number }) =>
    listMedia()
      .slice(0, limit ?? 30)
      .map((m) => ({ id: m.id, kind: m.kind, name: m.original_name, created_at: m.created_at, url: publicMedia(m).public_url })),
  ),
);

server.registerTool(
  'validate_post',
  {
    title: 'Проверить пост',
    description: 'Проверяет текст/медиа на лимиты платформы без сохранения.',
    inputSchema: {
      provider: z.enum(['threads', 'instagram']),
      content: z.string(),
      media_ids: z.array(z.string()).optional(),
      threads: threadsOpts,
      instagram: igOpts,
    },
  },
  run(({ provider, content, media_ids, threads, instagram }: any) => {
    const refs = (media_ids ?? []).map((id: string) => db.prepare('SELECT id, kind FROM media WHERE id=?').get(id));
    const errors = validatePost(provider, content, refs, buildOptions(threads, instagram));
    return errors.length ? { valid: false, errors } : { valid: true };
  }),
);

server.registerTool(
  'create_post',
  {
    title: 'Создать пост',
    description:
      'Создаёт пост(ы) — по одному на каждый канал. По умолчанию черновик. schedule_at или next_slot=true → запланировать. Для разных текстов под Threads и Instagram используйте overrides.',
    inputSchema: {
      channels: z.array(z.string()).min(1).describe('id или "threads:username" / "instagram:username"'),
      content: z.string().describe('Текст поста / подпись'),
      overrides: z.record(z.string()).optional().describe('Отдельный текст для канала: { "instagram:user": "…" }'),
      media_ids: z.array(z.string()).optional(),
      threads: threadsOpts,
      instagram: igOpts,
      schedule_at: z.string().optional().describe('Когда опубликовать'),
      next_slot: z.boolean().optional().describe('Поставить в ближайший свободный слот расписания канала'),
    },
  },
  run(async (a: any) => {
    const chans: ChannelRow[] = a.channels.map(resolveChannel);
    const overrides: Record<string, string> = {};
    for (const [k, v] of Object.entries((a.overrides ?? {}) as Record<string, string>)) overrides[resolveChannel(k).id] = v;
    const options = buildOptions(a.threads, a.instagram);

    // next_slot: у каждого канала свой слот → создаём по одному
    if (a.next_slot) {
      const out: PostView[] = [];
      for (const c of chans) {
        out.push(
          ...createPosts({
            channel_ids: [c.id],
            content: overrides[c.id] ?? a.content,
            media: a.media_ids,
            options,
            scheduled_at: nextFreeSlot(c.id),
            status: 'scheduled',
          }),
        );
      }
      return out.map(brief);
    }
    const scheduled_at = a.schedule_at ? parseWhen(a.schedule_at) : null;
    if (scheduled_at && Date.parse(scheduled_at) < Date.now()) throw new Error(`Время в прошлом: ${formatLocal(scheduled_at)}`);
    return createPosts({
      channel_ids: chans.map((c) => c.id),
      content: a.content,
      overrides,
      media: a.media_ids,
      options,
      scheduled_at,
      status: scheduled_at ? 'scheduled' : 'draft',
    }).map(brief);
  }),
);

server.registerTool(
  'update_post',
  {
    title: 'Изменить пост',
    description: 'Меняет текст, медиа, опции или время неопубликованного поста.',
    inputSchema: {
      id: z.string(),
      content: z.string().optional(),
      media_ids: z.array(z.string()).optional(),
      threads: threadsOpts,
      instagram: igOpts,
      schedule_at: z.string().nullable().optional().describe('null — снять с расписания (станет черновиком)'),
    },
  },
  run((a: any) => {
    const cur = getPost(a.id);
    const patch: any = { content: a.content, media: a.media_ids };
    if (a.threads || a.instagram) patch.options = buildOptions(a.threads, a.instagram, cur.options);
    if (a.schedule_at === null) {
      patch.scheduled_at = null;
      patch.status = 'draft';
    } else if (a.schedule_at) {
      patch.scheduled_at = parseWhen(a.schedule_at);
      patch.status = 'scheduled';
    }
    return brief(updatePost(a.id, patch));
  }),
);

server.registerTool(
  'schedule_post',
  {
    title: 'Запланировать',
    description: 'Ставит черновик в расписание: на конкретное время или в ближайший свободный слот.',
    inputSchema: { id: z.string(), at: z.string().optional(), next_slot: z.boolean().optional() },
  },
  run(({ id, at, next_slot }: { id: string; at?: string; next_slot?: boolean }) => {
    const p = getPost(id);
    const when = next_slot || !at ? nextFreeSlot(p.channel_id) : parseWhen(at);
    return brief(updatePost(id, { scheduled_at: when, status: 'scheduled' }));
  }),
);

server.registerTool(
  'publish_now',
  {
    title: 'Опубликовать сейчас',
    description: 'НЕОБРАТИМО публикует пост в соцсеть прямо сейчас. Вызывать только по явному подтверждению пользователя.',
    inputSchema: { id: z.string() },
  },
  run(async ({ id }: { id: string }) => brief(await publishPost(id, { force: true }))),
);

server.registerTool(
  'list_posts',
  {
    title: 'Список постов',
    description: 'Посты с фильтрами. status: draft,scheduled,published,failed (через запятую).',
    inputSchema: {
      status: z.string().optional(),
      channel: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().optional(),
    },
  },
  run((a: any) =>
    listPosts({
      status: a.status,
      channel_id: a.channel ? resolveChannel(a.channel).id : undefined,
      from: a.from ? parseWhen(a.from) : undefined,
      to: a.to ? parseWhen(a.to) : undefined,
      limit: a.limit ?? 50,
    }).map(brief),
  ),
);

server.registerTool('get_post', { title: 'Пост', description: 'Полная информация о посте.', inputSchema: { id: z.string() } }, run(({ id }: { id: string }) => brief(getPost(id))));

server.registerTool(
  'delete_post',
  {
    title: 'Удалить пост',
    description:
      'Удаляет пост из панели. from_network=true — НЕОБРАТИМО удаляет и саму публикацию в Threads (Instagram API удаление не поддерживает). Удаление из соцсети — только по явной просьбе пользователя.',
    inputSchema: { id: z.string(), from_network: z.boolean().optional() },
  },
  run(async ({ id, from_network }: { id: string; from_network?: boolean }) => {
    await deletePost(id, { remote: from_network });
    return from_network ? 'Удалено из панели и из соцсети' : 'Удалено из панели (в соцсети пост остался)';
  }),
);

server.registerTool(
  'duplicate_post',
  { title: 'Дублировать пост', description: 'Создаёт черновик-копию поста (текст, медиа, опции).', inputSchema: { id: z.string() } },
  run(({ id }: { id: string }) => brief(duplicatePost(id))),
);

server.registerTool(
  'delete_media',
  {
    title: 'Удалить медиа',
    description:
      'Удаляет файлы из библиотеки. Если файл нужен неопубликованным постам — вернёт ошибку со списком постов; force=true удалит файл и уберёт его из этих постов.',
    inputSchema: { ids: z.array(z.string()).min(1), force: z.boolean().optional() },
  },
  run(async ({ ids, force }: { ids: string[]; force?: boolean }) => {
    const out: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await deleteMedia(id, { force });
        out.push({ id, ok: true });
      } catch (e: any) {
        out.push({ id, ok: false, error: e.message });
      }
    }
    return out;
  }),
);

server.registerTool(
  'media_usage',
  { title: 'Где используется медиа', description: 'Неопубликованные посты, в которых используется файл.', inputSchema: { id: z.string() } },
  run(({ id }: { id: string }) => mediaUsage(id)),
);

server.registerTool(
  'set_time_slots',
  {
    title: 'Слоты очереди',
    description: 'Задаёт время публикаций канала для очереди (next_slot), формат HH:mm в часовом поясе панели.',
    inputSchema: { channel: z.string(), slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)) },
  },
  run(({ channel, slots }: { channel: string; slots: string[] }) => JSON.parse(updateChannel(resolveChannel(channel).id, { time_slots: slots }).time_slots)),
);

server.registerTool(
  'list_replies',
  {
    title: 'Ответы под постом',
    description: 'Ответы (Threads) или комментарии (Instagram) под опубликованным постом. parent_id — у вложенных ответов.',
    inputSchema: { post_id: z.string() },
  },
  run(async ({ post_id }: { post_id: string }) => listReplies(post_id)),
);

server.registerTool(
  'reply',
  {
    title: 'Ответить',
    description: 'Публикует ответ от имени канала: под постом или на конкретный ответ/комментарий (reply_id). Это публичное действие — отправлять только с согласия пользователя.',
    inputSchema: { post_id: z.string(), text: z.string(), reply_id: z.string().optional() },
  },
  run(async ({ post_id, text, reply_id }: { post_id: string; text: string; reply_id?: string }) => ({ id: await replyTo(post_id, text, reply_id) })),
);

server.registerTool(
  'hide_reply',
  {
    title: 'Скрыть ответ',
    description: 'Скрывает (или возвращает, hide=false) ответ/комментарий под постом.',
    inputSchema: { post_id: z.string(), reply_id: z.string(), hide: z.boolean().optional() },
  },
  run(async ({ post_id, reply_id, hide }: { post_id: string; reply_id: string; hide?: boolean }) => {
    await hideReply(post_id, reply_id, hide ?? true);
    return hide === false ? 'Ответ снова виден' : 'Ответ скрыт';
  }),
);

server.registerTool(
  'next_slot',
  { title: 'Свободный слот', description: 'Ближайшее свободное время по расписанию канала.', inputSchema: { channel: z.string() } },
  run(({ channel }: { channel: string }) => {
    const at = nextFreeSlot(resolveChannel(channel).id);
    return { at, local: formatLocal(at) };
  }),
);

server.registerTool(
  'post_insights',
  { title: 'Статистика поста', description: 'Обновляет и возвращает метрики опубликованного поста.', inputSchema: { id: z.string() } },
  run(async ({ id }: { id: string }) => brief(await refreshInsights(id))),
);

server.registerTool(
  'stats_summary',
  { title: 'Сводка', description: 'Суммарные метрики по каналам за N дней.', inputSchema: { days: z.number().int().optional() } },
  run(({ days }: { days?: number }) => {
    const s = statsSummary(days ?? 30);
    const names = new Map(listChannels().map((c) => [c.id, `${c.provider}:@${c.username}`]));
    return { ...s, byChannel: Object.fromEntries(Object.entries(s.byChannel).map(([k, v]) => [names.get(k) ?? k, v])) };
  }),
);

server.registerTool(
  'refresh_tokens',
  {
    title: 'Обновить токены',
    description: 'Обновляет токены. Без channel — только те, что скоро истекают; с channel — принудительно.',
    inputSchema: { channel: z.string().optional() },
  },
  run(async ({ channel }: { channel?: string }) => {
    if (channel) {
      const c = await refreshChannelToken(resolveChannel(channel).id);
      return publicChannel(c);
    }
    return await refreshDueTokens();
  }),
);

server.registerTool(
  'recent_logs',
  { title: 'Журнал', description: 'Последние события: публикации, ошибки, токены.', inputSchema: { limit: z.number().int().optional() } },
  run(({ limit }: { limit?: number }) => db.prepare('SELECT level, source, message, created_at FROM logs ORDER BY id DESC LIMIT ?').all(limit ?? 30)),
);

return server;
}
