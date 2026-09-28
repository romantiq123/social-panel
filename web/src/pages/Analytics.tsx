import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, BarChart3 } from 'lucide-react';
import { api, fmtDateTime, type Post } from '../api';
import { useStore } from '../store';
import { Button, Card, ChannelAvatar, Empty, PageHeader, Select, Spinner, useToast } from '../components/ui';

interface Stats {
  days: number;
  byChannel: Record<string, { posts: number; totals: Record<string, number> }>;
  counts: Record<string, number>;
}

const LABEL: Record<string, string> = {
  views: 'Просмотры',
  reach: 'Охват',
  likes: 'Лайки',
  replies: 'Ответы',
  comments: 'Комментарии',
  reposts: 'Репосты',
  quotes: 'Цитаты',
  shares: 'Поделились',
  saved: 'Сохранения',
  total_interactions: 'Взаимодействия',
};
const MAIN = ['views', 'reach', 'likes', 'replies', 'comments', 'reposts', 'shares', 'saved'];
const n = (v?: number) => (v ?? 0).toLocaleString('ru-RU');

export default function AnalyticsPage() {
  const { channels, version, bump } = useStore();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [sort, setSort] = useState('views');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    api.get<Stats>(`/api/stats?days=${days}`).then(setStats);
    api.get<Post[]>(`/api/posts?status=published&from=${from}`).then(setPosts);
  }, [days, version]);

  const sorted = useMemo(() => [...posts].sort((a, b) => (b.insights?.[sort] ?? -1) - (a.insights?.[sort] ?? -1)), [posts, sort]);
  const metricCols = useMemo(() => MAIN.filter((m) => posts.some((p) => p.insights && m in p.insights)), [posts]);

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ updated: number }>(`/api/stats/refresh?days=${days}`);
      toast('ok', `Обновлено постов: ${r.updated}`);
      bump();
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Аналитика"
        subtitle="Метрики подтягиваются автоматически каждые 3 часа для постов за последние 30 дней"
        actions={
          <>
            <Select className="w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </Select>
            <Button loading={busy} icon={<RefreshCw className="size-4" />} onClick={refresh}>
              Обновить
            </Button>
          </>
        }
      />

      {!stats ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {channels.map((c) => {
              const s = stats.byChannel[c.id];
              return (
                <Card key={c.id} className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <ChannelAvatar provider={c.provider} avatar={c.avatar_url} username={c.username} size={36} />
                    <div>
                      <div className="font-medium">@{c.username}</div>
                      <div className="text-xs text-zinc-500">
                        {s?.posts ?? 0} постов за {days} дн.{c.followers_count != null && ` · ${n(c.followers_count)} подписчиков`}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {(c.provider === 'threads' ? ['views', 'likes', 'replies'] : ['reach', 'likes', 'comments']).map((m) => (
                      <div key={m}>
                        <div className="text-xl font-semibold tabular-nums">{n(s?.totals[m] ?? (m === 'reach' ? s?.totals.views : 0))}</div>
                        <div className="text-xs text-zinc-500">{LABEL[m]}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>

          {posts.length === 0 ? (
            <Empty icon={<BarChart3 className="size-8" />} title="Нет опубликованных постов за период" />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                    <th className="px-4 py-2.5 font-medium">Пост</th>
                    <th className="px-3 py-2.5 font-medium">Дата</th>
                    {metricCols.map((m) => (
                      <th key={m} className="cursor-pointer px-3 py-2.5 text-right font-medium hover:text-zinc-800" onClick={() => setSort(m)}>
                        {LABEL[m]} {sort === m && '↓'}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="max-w-sm px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {p.channel && <ChannelAvatar provider={p.channel.provider} avatar={p.channel.avatar_url} username={p.channel.username} size={26} />}
                          <span className="line-clamp-1">{p.content || '—'}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">{fmtDateTime(p.published_at)}</td>
                      {metricCols.map((m) => (
                        <td key={m} className="px-3 py-2.5 text-right tabular-nums">
                          {p.insights?.[m] != null ? n(p.insights[m]) : <span className="text-zinc-300">—</span>}
                        </td>
                      ))}
                      <td className="px-3">
                        {p.permalink && (
                          <a href={p.permalink} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-700">
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
