import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Pencil, RefreshCw, Send, Trash2, FileText } from 'lucide-react';
import { api, fmtDateTime, type Post, type PostStatus } from '../api';
import { useStore } from '../store';
import { Button, ChannelAvatar, Empty, PageHeader, Spinner, StatusBadge, Tabs, useToast, Select } from '../components/ui';
import { MediaThumb } from '../components/MediaPicker';

type Filter = 'upcoming' | 'draft' | 'published' | 'failed' | 'all';
const FILTER_STATUS: Record<Filter, string> = {
  upcoming: 'scheduled,publishing',
  draft: 'draft',
  published: 'published',
  failed: 'failed',
  all: '',
};

const METRIC_LABEL: Record<string, string> = { views: 'просм.', likes: 'лайки', replies: 'ответы', reposts: 'репосты', quotes: 'цитаты', shares: 'поделились', reach: 'охват', comments: 'комм.', saved: 'сохр.' };

export default function PostsPage() {
  const { openComposer, version, bump, channels } = useStore();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [channel, setChannel] = useState('');
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (FILTER_STATUS[filter]) qs.set('status', FILTER_STATUS[filter]);
    if (channel) qs.set('channel_id', channel);
    api.get<Post[]>(`/api/posts?${qs}`).then((r) => {
      if (filter === 'upcoming') r.sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
      setPosts(r);
    });
  }, [filter, channel, version]);

  const act = async (p: Post, action: 'publish' | 'delete' | 'duplicate' | 'insights') => {
    if (action === 'publish' && !confirm(`Опубликовать сейчас в @${p.channel?.username}?`)) return;
    if (action === 'delete' && !confirm(p.status === 'published' ? 'Удалить из панели? (в соцсети пост останется)' : 'Удалить пост?')) return;
    setBusy(p.id + action);
    try {
      if (action === 'delete') await api.del(`/api/posts/${p.id}`);
      else {
        const r = await api.post<Post>(`/api/posts/${p.id}/${action}`);
        if (action === 'publish' && r.status === 'failed') throw new Error(r.error ?? 'Ошибка');
        if (action === 'duplicate') openComposer({ post: r });
      }
      toast('ok', { publish: 'Опубликовано', delete: 'Удалено', duplicate: 'Копия создана', insights: 'Статистика обновлена' }[action]);
      bump();
    } catch (e: any) {
      toast('error', e.message);
      bump();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Посты"
        actions={
          <>
            <Select className="w-44" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">Все каналы</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider === 'threads' ? 'Threads' : 'Instagram'} · @{c.username}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="mb-4 overflow-x-auto">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'upcoming', label: 'Запланированные' },
            { value: 'draft', label: 'Черновики' },
            { value: 'published', label: 'Опубликованные' },
            { value: 'failed', label: 'Ошибки' },
            { value: 'all', label: 'Все' },
          ]}
        />
      </div>

      {!posts ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : posts.length === 0 ? (
        <Empty icon={<FileText className="size-8" />} title="Здесь пока пусто" action={<Button variant="primary" onClick={() => openComposer()}>Создать пост</Button>} />
      ) : (
        <div className="space-y-2.5">
          {posts.map((p) => (
            <div key={p.id} className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              {p.channel && <ChannelAvatar provider={p.channel.provider} avatar={p.channel.avatar_url} username={p.channel.username} size={38} />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">@{p.channel?.username}</span>
                  <StatusBadge status={p.status as PostStatus} />
                  <span className="text-zinc-500">
                    {p.status === 'published' ? fmtDateTime(p.published_at) : p.scheduled_at ? fmtDateTime(p.scheduled_at) : 'без даты'}
                  </span>
                  {p.options.instagram?.type && p.options.instagram.type !== 'feed' && <span className="text-xs uppercase text-zinc-400">{p.options.instagram.type}</span>}
                  {(p.options.threads?.thread?.length ?? 0) > 0 && <span className="text-xs text-zinc-400">цепочка из {p.options.threads!.thread!.length + 1}</span>}
                </div>
                <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{p.content || <i className="text-zinc-400">без текста</i>}</p>
                {p.media.length > 0 && (
                  <div className="mt-2 flex gap-1.5">
                    {p.media.slice(0, 6).map((m) => (
                      <MediaThumb key={m.id} m={m} className="size-12 rounded-md" />
                    ))}
                    {p.media.length > 6 && <div className="flex size-12 items-center justify-center rounded-md bg-zinc-100 text-xs dark:bg-zinc-800">+{p.media.length - 6}</div>}
                  </div>
                )}
                {p.error && <div className="mt-2 whitespace-pre-line rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{p.error}</div>}
                {p.insights && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {Object.entries(p.insights).map(([k, v]) => (
                      <span key={k}>
                        <b className="text-zinc-800 tabular-nums dark:text-zinc-200">{v.toLocaleString('ru-RU')}</b> {METRIC_LABEL[k] ?? k}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-start">
                {p.status === 'published' ? (
                  <>
                    {p.permalink && (
                      <a href={p.permalink} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />} title="Открыть" />
                      </a>
                    )}
                    <Button size="sm" variant="ghost" loading={busy === p.id + 'insights'} icon={<RefreshCw className="size-4" />} title="Обновить статистику" onClick={() => act(p, 'insights')} />
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} title="Редактировать" onClick={() => openComposer({ post: p })} disabled={p.status === 'publishing'} />
                    <Button size="sm" variant="ghost" loading={busy === p.id + 'publish'} icon={<Send className="size-4" />} title="Опубликовать сейчас" onClick={() => act(p, 'publish')} disabled={p.status === 'publishing'} />
                  </>
                )}
                <Button size="sm" variant="ghost" loading={busy === p.id + 'duplicate'} icon={<Copy className="size-4" />} title="Дублировать" onClick={() => act(p, 'duplicate')} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} title="Удалить" onClick={() => act(p, 'delete')} disabled={p.status === 'publishing'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
