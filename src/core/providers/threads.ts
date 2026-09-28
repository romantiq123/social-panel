import { getSettings } from '../settings.ts';
import type { ChannelRow, ProviderApi, PublishInput } from '../types.ts';
import { graph, GraphError, sleep } from './graph.ts';

const BASE = 'https://graph.threads.net';
const v = () => `${BASE}/${getSettings().graph_version_threads}`;

export const THREADS_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_insights',
  'threads_manage_replies',
  'threads_read_replies',
  'threads_delete',
];

export const redirectUri = (provider: string) => `${getSettings().public_base_url}/oauth/${provider}/callback`;

function creds() {
  const s = getSettings();
  if (!s.threads_app_id || !s.threads_app_secret) throw new Error('Не заданы Threads App ID / App Secret (Настройки)');
  return { id: s.threads_app_id, secret: s.threads_app_secret };
}

async function waitContainer(id: string, token: string) {
  // Видео обрабатывается до нескольких минут; картинки/текст — секунды
  for (let i = 0; i < 100; i++) {
    const r = await graph('GET', `${v()}/${id}`, { fields: 'status,error_message', access_token: token });
    if (r.status === 'FINISHED' || r.status === 'PUBLISHED') return;
    if (r.status === 'ERROR' || r.status === 'EXPIRED') throw new GraphError(`Контейнер Threads: ${r.error_message || r.status}`, 9004);
    await sleep(i < 5 ? 2000 : 5000);
  }
  throw new Error('Контейнер Threads не обработался за отведённое время');
}

async function createContainer(ch: ChannelRow, params: Record<string, any>) {
  const r = await graph('POST', `${v()}/${ch.external_id}/threads`, { ...params, access_token: ch.access_token });
  return r.id as string;
}

async function publishPart(
  ch: ChannelRow,
  text: string,
  media: { kind: 'image' | 'video'; url: string }[],
  extra: Record<string, any>,
): Promise<string> {
  let creation: string;
  if (media.length === 0) {
    creation = await createContainer(ch, { media_type: 'TEXT', text, ...extra });
  } else if (media.length === 1) {
    const m = media[0];
    creation = await createContainer(ch, {
      media_type: m.kind === 'video' ? 'VIDEO' : 'IMAGE',
      [m.kind === 'video' ? 'video_url' : 'image_url']: m.url,
      text,
      ...extra,
    });
  } else {
    const children: string[] = [];
    for (const m of media) {
      const id = await createContainer(ch, {
        media_type: m.kind === 'video' ? 'VIDEO' : 'IMAGE',
        [m.kind === 'video' ? 'video_url' : 'image_url']: m.url,
        is_carousel_item: true,
      });
      children.push(id);
    }
    for (const id of children) await waitContainer(id, ch.access_token);
    creation = await createContainer(ch, { media_type: 'CAROUSEL', children: children.join(','), text, ...extra });
  }
  await waitContainer(creation, ch.access_token);
  const pub = await graph('POST', `${v()}/${ch.external_id}/threads_publish`, { creation_id: creation, access_token: ch.access_token });
  return pub.id as string;
}

export const threads: ProviderApi = {
  id: 'threads',
  label: 'Threads',
  limits: { text: 500, media: 20 },

  authorizeUrl(state) {
    const { id } = creds();
    const u = new URL('https://threads.net/oauth/authorize');
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirectUri('threads'));
    u.searchParams.set('scope', THREADS_SCOPES.join(','));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  },

  async exchangeCode(code) {
    const { id, secret } = creds();
    const r = await graph('POST', `${BASE}/oauth/access_token`, {
      client_id: id,
      client_secret: secret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri('threads'),
      code,
    });
    return { access_token: r.access_token, user_id: String(r.user_id) };
  },

  async toLongLived(token) {
    const { secret } = creds();
    const r = await graph('GET', `${BASE}/access_token`, { grant_type: 'th_exchange_token', client_secret: secret, access_token: token });
    return { access_token: r.access_token, expires_in: r.expires_in };
  },

  async refresh(token) {
    const r = await graph('GET', `${BASE}/refresh_access_token`, { grant_type: 'th_refresh_token', access_token: token });
    return { access_token: r.access_token, expires_in: r.expires_in };
  },

  async profile(token) {
    const r = await graph('GET', `${v()}/me`, { fields: 'id,username,name,threads_profile_picture_url', access_token: token });
    let followers: number | undefined;
    try {
      const ins = await graph('GET', `${v()}/me/threads_insights`, { metric: 'followers_count', access_token: token });
      followers = ins.data?.[0]?.total_value?.value;
    } catch {
      /* нет прав на инсайты — не критично */
    }
    return { external_id: String(r.id), username: r.username, name: r.name, avatar_url: r.threads_profile_picture_url, followers_count: followers };
  },

  async publish({ channel, content, media, options, resolveMedia }: PublishInput) {
    const o = options.threads ?? {};
    const extra: Record<string, any> = {};
    if (o.topic_tag) extra.topic_tag = o.topic_tag.replace(/^#/, '');
    if (o.reply_control && o.reply_control !== 'everyone') extra.reply_control = o.reply_control;

    const rootId = await publishPart(channel, content, media, extra);
    const warnings: string[] = [];
    let prev = rootId;
    for (const [i, part] of (o.thread ?? []).entries()) {
      if (!part.text?.trim() && !part.media?.length) continue;
      try {
        prev = await publishPart(channel, part.text, resolveMedia(part.media ?? []), { reply_to_id: prev });
      } catch (e: any) {
        // Основной пост уже вышел — не валим всю публикацию, но сообщаем
        warnings.push(`Часть цепочки #${i + 2} не опубликована: ${e.message}`);
        break;
      }
    }
    let permalink: string | undefined;
    try {
      const r = await graph('GET', `${v()}/${rootId}`, { fields: 'permalink', access_token: channel.access_token });
      permalink = r.permalink;
    } catch {}
    return { external_id: rootId, permalink, warnings };
  },

  async insights(channel, externalId) {
    const r = await graph('GET', `${v()}/${externalId}/insights`, {
      metric: 'views,likes,replies,reposts,quotes,shares',
      access_token: channel.access_token,
    });
    const out: Record<string, number> = {};
    for (const m of r.data ?? []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
    return out;
  },

  async publishingLimit(channel) {
    const r = await graph('GET', `${v()}/${channel.external_id}/threads_publishing_limit`, {
      fields: 'quota_usage,config',
      access_token: channel.access_token,
    });
    const d = r.data?.[0];
    return d ? { used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 250 } : null;
  },
};
