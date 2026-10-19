import { useEffect, useState } from 'react';
import { EyeOff, Eye, Reply, RefreshCw, Send, CornerDownRight } from 'lucide-react';
import { api, LIMITS, textLength, type Post } from '../api';
import { Button, cx, Modal, Spinner, Textarea, useToast } from './ui';

interface ReplyItem {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  hidden?: boolean;
  parent_id?: string;
  like_count?: number;
}

export default function Replies({ post, onClose }: { post: Post; onClose: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<ReplyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<ReplyItem | null>(null);
  const [sending, setSending] = useState(false);
  const provider = post.channel?.provider ?? 'threads';
  const noun = provider === 'instagram' ? 'комментарии' : 'ответы';

  const load = async () => {
    setError(null);
    try {
      setItems(await api.get<ReplyItem[]>(`/api/posts/${post.id}/replies`));
    } catch (e: any) {
      setError(e.message);
      setItems([]);
    }
  };
  useEffect(() => {
    load();
  }, [post.id]);

  const send = async () => {
    if (!confirm(`Опубликовать ответ от @${post.channel?.username}${target ? ` пользователю @${target.username}` : ''}?`)) return;
    setSending(true);
    try {
      await api.post(`/api/posts/${post.id}/replies`, { text, reply_id: target?.id });
      toast('ok', 'Ответ опубликован');
      setText('');
      setTarget(null);
      // Meta отдаёт новый ответ не мгновенно
      setTimeout(load, 2500);
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setSending(false);
    }
  };

  const toggleHide = async (r: ReplyItem) => {
    try {
      await api.post(`/api/posts/${post.id}/replies/${r.id}/hide`, { hide: !r.hidden });
      setItems((xs) => xs?.map((x) => (x.id === r.id ? { ...x, hidden: !r.hidden } : x)) ?? null);
    } catch (e: any) {
      toast('error', e.message);
    }
  };

  const own = (r: ReplyItem) => r.username === post.channel?.username;
  const limit = LIMITS[provider].text;
  const len = textLength(text, provider);

  return (
    <Modal open onClose={onClose} title={`${provider === 'instagram' ? 'Комментарии' : 'Ответы'} · @${post.channel?.username}`} width="max-w-2xl">
      <div className="mb-4 line-clamp-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{post.content || '—'}</div>

      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
        <span>{items ? `${items.length} ${noun}` : 'Загрузка…'}</span>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={load}>
          Обновить
        </Button>
      </div>

      <div className="max-h-[45vh] space-y-1 overflow-y-auto">
        {!items ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : error ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">Пока никто не ответил</div>
        ) : (
          items.map((r) => (
            <div key={r.id} className={cx('group flex gap-2 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60', r.parent_id && 'ml-6', r.hidden && 'opacity-50')}>
              {r.parent_id && <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-zinc-300" />}
              <div className="min-w-0 flex-1">
                <div className="text-xs">
                  <span className={cx('font-semibold', own(r) && 'text-brand-600')}>@{r.username}</span>
                  <span className="ml-2 text-zinc-400">{new Date(r.timestamp).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  {r.hidden && <span className="ml-2 text-zinc-400">скрыт</span>}
                </div>
                <div className="whitespace-pre-wrap break-words text-sm">{r.text}</div>
              </div>
              {!own(r) && (
                <div className="flex shrink-0 items-start gap-0.5 opacity-60 group-hover:opacity-100">
                  <button title="Ответить" onClick={() => setTarget(r)} className="rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                    <Reply className="size-3.5" />
                  </button>
                  <button title={r.hidden ? 'Показать' : 'Скрыть'} onClick={() => toggleHide(r)} className="rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                    {r.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {target && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-1.5 text-xs text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">
            <span className="truncate">
              Ответ @{target.username}: «{target.text.slice(0, 60)}»
            </span>
            <button className="ml-2 font-medium underline" onClick={() => setTarget(null)}>
              отмена
            </button>
          </div>
        )}
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={target ? `Ответ @${target.username}…` : 'Ответ под постом…'} />
        <div className="mt-2 flex items-center justify-between">
          <span className={cx('text-xs tabular-nums', len > limit ? 'text-red-600' : 'text-zinc-400')}>
            {len}/{limit}
          </span>
          <Button variant="primary" size="sm" loading={sending} disabled={!text.trim() || len > limit} icon={<Send className="size-4" />} onClick={send}>
            Ответить
          </Button>
        </div>
      </div>
    </Modal>
  );
}
