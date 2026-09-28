import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api, fmtTime, postDate, type Post } from '../api';
import { useStore } from '../store';
import { Button, cx, PageHeader, ProviderIcon, Select, STATUS_DOT, Tabs, useToast } from '../components/ui';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function PostChip({ p, onOpen, compact }: { p: Post; onOpen: () => void; compact?: boolean }) {
  const draggable = p.status === 'scheduled' || p.status === 'draft' || p.status === 'failed';
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData('text/post', p.id)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cx(
        'group flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-xs transition hover:shadow-sm',
        p.status === 'failed' ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50' : 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      title={p.content}
    >
      <span className={cx('size-1.5 shrink-0 rounded-full', STATUS_DOT[p.status])} />
      {p.channel && <ProviderIcon provider={p.channel.provider} className="size-3 shrink-0 text-zinc-500" />}
      <span className="shrink-0 tabular-nums text-zinc-500">{fmtTime(postDate(p))}</span>
      {!compact && <span className="truncate">{p.content || (p.media.length ? '📎 медиа' : '—')}</span>}
      {p.media[0] && !compact && <img src={p.media[0].kind === 'image' ? p.media[0].url : undefined} className={cx('ml-auto size-5 shrink-0 rounded object-cover', p.media[0].kind !== 'image' && 'hidden')} alt="" />}
    </button>
  );
}

export default function CalendarPage() {
  const { openComposer, version, bump, channels } = useStore();
  const toast = useToast();
  const [view, setView] = useState<'month' | 'week'>(() => (window.innerWidth < 768 ? 'week' : 'month'));
  const [cursor, setCursor] = useState(() => new Date());
  const [posts, setPosts] = useState<Post[]>([]);
  const [channel, setChannel] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);

  const days = useMemo(() => {
    if (view === 'week') {
      const s = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const s = startOfWeek(first);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const n = Math.ceil(((last.getTime() - s.getTime()) / 86_400_000 + 1) / 7) * 7;
    return Array.from({ length: n }, (_, i) => addDays(s, i));
  }, [view, cursor]);

  useEffect(() => {
    const from = days[0].toISOString();
    const to = addDays(days[days.length - 1], 1).toISOString();
    api
      .get<Post[]>(`/api/posts?from=${from}&to=${to}${channel ? `&channel_id=${channel}` : ''}`)
      .then(setPosts)
      .catch((e) => toast('error', e.message));
  }, [days, version, channel]);

  // автообновление, пока есть посты в процессе
  useEffect(() => {
    if (!posts.some((p) => p.status === 'publishing')) return;
    const t = setTimeout(bump, 5000);
    return () => clearTimeout(t);
  }, [posts]);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of [...posts].sort((a, b) => postDate(a).localeCompare(postDate(b)))) {
      const k = dayKey(new Date(postDate(p)));
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts]);

  const shift = (n: number) => setCursor((c) => (view === 'week' ? addDays(c, 7 * n) : new Date(c.getFullYear(), c.getMonth() + n, 1)));
  const today = dayKey(new Date());

  const onDrop = async (day: Date, e: React.DragEvent) => {
    setDragOver(null);
    const id = e.dataTransfer.getData('text/post');
    const p = posts.find((x) => x.id === id);
    if (!p) return;
    const old = new Date(postDate(p));
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    if (next.getTime() < Date.now()) return toast('error', 'Нельзя перенести в прошлое');
    try {
      await api.put(`/api/posts/${id}`, { scheduled_at: next.toISOString(), status: p.status === 'scheduled' ? 'scheduled' : 'draft' });
      toast('ok', `Перенесено на ${next.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`);
      bump();
    } catch (err: any) {
      toast('error', err.message);
    }
  };

  const newAt = (d: Date) => {
    const now = new Date();
    const date = dayKey(d) === today ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0);
    if (date.getTime() < Date.now()) return openComposer();
    openComposer({ date });
  };

  const title =
    view === 'month'
      ? cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      : `${days[0].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${days[6].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const counts = posts.reduce<Record<string, number>>((a, p) => ((a[p.status] = (a[p.status] ?? 0) + 1), a), {});

  return (
    <div>
      <PageHeader
        title="Календарь"
        subtitle={`Запланировано: ${counts.scheduled ?? 0} · Опубликовано: ${counts.published ?? 0} · Черновики: ${counts.draft ?? 0}${counts.failed ? ` · Ошибки: ${counts.failed}` : ''}`}
        actions={
          <>
            {channels.length > 1 && (
              <Select className="w-44" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">Все каналы</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.provider === 'threads' ? 'Threads' : 'Instagram'} · @{c.username}
                  </option>
                ))}
              </Select>
            )}
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { value: 'week', label: 'Неделя' },
                { value: 'month', label: 'Месяц' },
              ]}
            />
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => shift(-1)} icon={<ChevronLeft className="size-4" />} />
        <Button size="sm" variant="ghost" onClick={() => shift(1)} icon={<ChevronRight className="size-4" />} />
        <Button size="sm" onClick={() => setCursor(new Date())}>
          Сегодня
        </Button>
        <div className="ml-2 text-lg font-semibold capitalize">{title}</div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="hidden grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500 md:grid dark:border-zinc-800 dark:bg-zinc-950">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className={cx('grid grid-cols-1 md:grid-cols-7', view === 'month' ? 'md:auto-rows-[minmax(120px,auto)]' : 'md:min-h-[480px]')}>
          {days.map((d, i) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const outside = view === 'month' && d.getMonth() !== cursor.getMonth();
            const past = addDays(d, 1).getTime() < Date.now();
            return (
              <div
                key={k}
                onClick={() => !past && newAt(d)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(k);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => onDrop(d, e)}
                className={cx(
                  'group relative space-y-1 border-zinc-200 p-1.5 transition dark:border-zinc-800',
                  'border-b md:border-r',
                  (i + 1) % 7 === 0 && 'md:border-r-0',
                  outside && 'bg-zinc-50/60 dark:bg-zinc-950/40',
                  !past && 'cursor-pointer hover:bg-brand-50/40 dark:hover:bg-brand-700/10',
                  dragOver === k && 'bg-brand-50 ring-2 ring-inset ring-brand-500 dark:bg-brand-700/20',
                )}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span
                    className={cx(
                      'flex size-6 items-center justify-center rounded-full text-xs font-medium',
                      k === today ? 'bg-brand-600 text-white' : outside ? 'text-zinc-400' : 'text-zinc-700 dark:text-zinc-300',
                    )}
                  >
                    {d.getDate()}
                  </span>
                  <span className="text-xs text-zinc-400 md:hidden">{d.toLocaleDateString('ru-RU', { weekday: 'short', month: 'short' })}</span>
                  {!past && <Plus className="size-3.5 text-zinc-400 opacity-0 transition group-hover:opacity-100" />}
                </div>
                {list.map((p) => (
                  <PostChip key={p.id} p={p} onOpen={() => openComposer({ post: p })} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-400">Кликните по дню, чтобы создать пост. Перетаскивайте посты между днями, чтобы перенести.</p>
    </div>
  );
}
