export type Provider = 'threads' | 'instagram';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

export interface MediaRef {
  id: string;
  kind: 'image' | 'video';
}

export interface ThreadsOptions {
  /** Тема (topic tag) поста, без # */
  topic_tag?: string;
  /** Кто может отвечать */
  reply_control?: 'everyone' | 'accounts_you_follow' | 'mentioned_only';
  /** Продолжение цепочки: каждая часть публикуется ответом на предыдущую */
  thread?: { text: string; media?: MediaRef[] }[];
}

export interface InstagramOptions {
  /** feed — пост/карусель, reel — рилс, story — сторис */
  type?: 'feed' | 'reel' | 'story';
  /** Первый комментарий (часто — хэштеги) */
  first_comment?: string;
  /** Показывать рилс в ленте */
  share_to_feed?: boolean;
}

export interface PostOptions {
  threads?: ThreadsOptions;
  instagram?: InstagramOptions;
}

export interface ChannelRow {
  id: string;
  provider: Provider;
  external_id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
  access_token: string;
  token_expires_at: string | null;
  token_refreshed_at: string | null;
  status: 'active' | 'expired' | 'error';
  last_error: string | null;
  time_slots: string;
  followers_count: number | null;
  created_at: string;
}

export interface PostRow {
  id: string;
  group_id: string;
  channel_id: string;
  status: PostStatus;
  content: string;
  media: string;
  options: string;
  scheduled_at: string | null;
  published_at: string | null;
  external_id: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  insights: string | null;
  insights_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishInput {
  channel: ChannelRow;
  content: string;
  media: { kind: 'image' | 'video'; url: string }[];
  options: PostOptions;
  resolveMedia: (refs: MediaRef[]) => { kind: 'image' | 'video'; url: string }[];
}

export interface PublishResult {
  external_id: string;
  permalink?: string;
  warnings?: string[];
}

export interface Profile {
  external_id: string;
  username: string;
  name?: string;
  avatar_url?: string;
  followers_count?: number;
}

export interface TokenInfo {
  access_token: string;
  expires_in?: number;
  user_id?: string;
}

export interface ProviderApi {
  id: Provider;
  label: string;
  limits: { text: number; media: number };
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenInfo>;
  toLongLived(shortToken: string): Promise<TokenInfo>;
  refresh(token: string): Promise<TokenInfo>;
  profile(token: string): Promise<Profile>;
  publish(input: PublishInput): Promise<PublishResult>;
  insights(channel: ChannelRow, externalId: string, options: PostOptions): Promise<Record<string, number>>;
  publishingLimit(channel: ChannelRow): Promise<{ used: number; total: number } | null>;
}
