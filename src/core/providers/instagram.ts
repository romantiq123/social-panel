import { getSettings } from '../settings.ts';
import type { ChannelRow, ProviderApi, PublishInput } from '../types.ts';
import { graph, GraphError, sleep } from './graph.ts';
import { redirectUri } from './threads.ts';

// Instagram API with Instagram Login — не требует страницы Facebook
const BASE = 'https://graph.instagram.com';
const v = () => `${BASE}/${getSettings().graph_version_instagram}`;

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
  'instagram_business_manage_comments',
];

function creds() {
  const s = getSettings();
  if (!s.instagram_app_id || !s.instagram_app_secret) throw new Error('Не заданы Instagram App ID / App Secret (Настройки)');
  return { id: s.instagram_app_id, secret: s.instagram_app_secret };
}

async function waitContainer(id: string, token: string) {
  for (let i = 0; i < 100; i++) {
    const r = await graph('GET', `${v()}/${id}`, { fields: 'status_code,status', access_token: token });
    if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new GraphError(`Контейнер Instagram: ${r.status || r.status_code}`, 9004);
    await sleep(i < 5 ? 2000 : 5000);
  }
  throw new Error('Контейнер Instagram не обработался за отведённое время');
}

async function create(ch: ChannelRow, params: Record<string, any>) {
  const r = await graph('POST', `${v()}/${ch.external_id}/media`, { ...params, access_token: ch.access_token });
  return r.id as string;
}

export const instagram: ProviderApi = {
  id: 'instagram',
  label: 'Instagram',
  limits: { text: 2200, media: 10 },

  authorizeUrl(state) {
    const { id } = creds();
    const u = new URL('https://www.instagram.com/oauth/authorize');
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirectUri('instagram'));
    u.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  },

  async exchangeCode(code) {
    const { id, secret } = creds();
    const r = await graph('POST', 'https://api.instagram.com/oauth/access_token', {
      client_id: id,
      client_secret: secret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri('instagram'),
      code,
    });
    const d = r.data?.[0] ?? r;
    return { access_token: d.access_token, user_id: String(d.user_id) };
  },

  async toLongLived(token) {
    const { secret } = creds();
    const r = await graph('GET', `${BASE}/access_token`, { grant_type: 'ig_exchange_token', client_secret: secret, access_token: token });
    return { access_token: r.access_token, expires_in: r.expires_in };
  },

  async refresh(token) {
    const r = await graph('GET', `${BASE}/refresh_access_token`, { grant_type: 'ig_refresh_token', access_token: token });
    return { access_token: r.access_token, expires_in: r.expires_in };
  },

  async profile(token) {
    const r = await graph('GET', `${v()}/me`, {
      fields: 'user_id,username,name,profile_picture_url,followers_count',
      access_token: token,
    });
    return {
      external_id: String(r.user_id ?? r.id),
      username: r.username,
      name: r.name,
      avatar_url: r.profile_picture_url,
      followers_count: r.followers_count,
    };
  },

  async publish({ channel, content, media, options }: PublishInput) {
    const o = options.instagram ?? {};
    const type = o.type ?? (media.length === 1 && media[0].kind === 'video' ? 'reel' : 'feed');
    if (media.length === 0) throw new GraphError('Instagram не публикует посты без медиа', 100);

    let creation: string;
    if (type === 'story') {
      const m = media[0];
      creation = await create(channel, {
        media_type: 'STORIES',
        [m.kind === 'video' ? 'video_url' : 'image_url']: m.url,
      });
    } else if (type === 'reel') {
      const m = media.find((x) => x.kind === 'video');
      if (!m) throw new GraphError('Для рилса нужно видео', 100);
      creation = await create(channel, {
        media_type: 'REELS',
        video_url: m.url,
        caption: content,
        share_to_feed: o.share_to_feed ?? true,
      });
    } else if (media.length === 1) {
      const m = media[0];
      creation =
        m.kind === 'video'
          ? await create(channel, { media_type: 'REELS', video_url: m.url, caption: content, share_to_feed: true })
          : await create(channel, { image_url: m.url, caption: content });
    } else {
      const children: string[] = [];
      for (const m of media) {
        children.push(
          await create(
            channel,
            m.kind === 'video'
              ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: true }
              : { image_url: m.url, is_carousel_item: true },
          ),
        );
      }
      for (const id of children) await waitContainer(id, channel.access_token);
      creation = await create(channel, { media_type: 'CAROUSEL', children: children.join(','), caption: content });
    }

    await waitContainer(creation, channel.access_token);
    const pub = await graph('POST', `${v()}/${channel.external_id}/media_publish`, { creation_id: creation, access_token: channel.access_token });
    const id = pub.id as string;

    const warnings: string[] = [];
    if (o.first_comment?.trim() && type !== 'story') {
      try {
        await graph('POST', `${v()}/${id}/comments`, { message: o.first_comment, access_token: channel.access_token });
      } catch (e: any) {
        warnings.push(`Первый комментарий не добавлен: ${e.message}`);
      }
    }
    let permalink: string | undefined;
    try {
      permalink = (await graph('GET', `${v()}/${id}`, { fields: 'permalink', access_token: channel.access_token })).permalink;
    } catch {}
    return { external_id: id, permalink, warnings };
  },

  async insights(channel, externalId, options) {
    const type = options.instagram?.type;
    const sets =
      type === 'story'
        ? ['views,reach,replies,shares,total_interactions', 'reach,replies']
        : type === 'reel'
          ? ['views,reach,likes,comments,saved,shares,total_interactions', 'reach,likes,comments,saved,shares']
          : ['views,reach,likes,comments,saved,shares,total_interactions', 'reach,likes,comments,saved'];
    let lastErr: unknown;
    for (const metric of sets) {
      try {
        const r = await graph('GET', `${v()}/${externalId}/insights`, { metric, access_token: channel.access_token });
        const out: Record<string, number> = {};
        for (const m of r.data ?? []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
        return out;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },

  async publishingLimit(channel) {
    const r = await graph('GET', `${v()}/${channel.external_id}/content_publishing_limit`, {
      fields: 'quota_usage,config',
      access_token: channel.access_token,
    });
    const d = r.data?.[0];
    return d ? { used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 100 } : null;
  },
};
