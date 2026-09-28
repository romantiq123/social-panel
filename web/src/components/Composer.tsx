import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, X, ChevronLeft, ChevronRight, Plus, Trash2, Send, Clock, Save, ListPlus, AlertTriangle, PenLine, Signature as SigIcon } from 'lucide-react';
import { api, fromLocalInput, LIMITS, textLength, toLocalInput, type Channel, type Media, type MediaRef, type Post, type PostOptions, type Provider, type Signature } from '../api';
import { useStore } from '../store';
import { Button, ChannelAvatar, cx, Input, Label, Modal, ProviderIcon, Select, Textarea, useToast, Badge } from './ui';
import MediaPicker, { MediaThumb, useUpload } from './MediaPicker';
import Preview from './Preview';

type M = MediaRef & { url: string };
type Part = { text: string; media: M[] };

function validate(provider: Provider, text: string, media: M[], opts: PostOptions): string[] {
  const e: string[] = [];
  const L = LIMITS[provider];
  const len = textLength(text, provider);
  if (len > L.text) e.push(`Текст: ${len}/${L.text}`);
  if (media.length > L.media) e.push(`Медиа: максимум ${L.media}`);
  if (provider === 'threads') {
    if (!text.trim() && !media.length) e.push('Нужен текст или медиа');
    if (opts.threads?.topic_tag && /[.&]/.test(opts.threads.topic_tag)) e.push('Тема без «.» и «&»');
    (opts.threads?.thread ?? []).forEach((p, i) => textLength(p.text, 'threads') > 500 && e.push(`Часть #${i + 2} длиннее 500`));
  } else {
    const t = opts.instagram?.type ?? 'feed';
    if (!media.length) e.push('Instagram требует фото или видео');
    if (t === 'story' && media.length > 1) e.push('Сторис — одно медиа');
    if (t === 'reel' && !media.some((m) => m.kind === 'video')) e.push('Рилсу нужно видео');
    const tags = text.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    if (tags > 30) e.push(`Хэштеги: ${tags}/30`);
  }
  return e;
}

function Counter({ text, provider }: { text: string; provider: Provider }) {
  const n = textLength(text, provider);
  const max = LIMITS[provider].text;
  return (
    <span className={cx('tabular-nums', n > max ? 'font-semibold text-red-600' : n > max * 0.9 ? 'text-amber-600' : 'text-zinc-400')}>
      {n}/{max}
    </span>
  );
}

function MediaStrip({ media, onChange, onAdd }: { media: M[]; onChange: (m: M[]) => void; onAdd: () => void }) {
  const move = (i: number, d: number) => {
    const next = [...media];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {media.map((m, i) => (
        <div key={m.id + i} className="group relative size-20 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <MediaThumb m={m} className="size-full" />
          <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 transition group-hover:opacity-100">
            <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded bg-white/90 p-0.5 text-zinc-800 disabled:opacity-30">
              <ChevronLeft className="size-3.5" />
            </button>
            <button disabled={i === media.length - 1} onClick={() => move(i, 1)} className="rounded bg-white/90 p-0.5 text-zinc-800 disabled:opacity-30">
              <ChevronRight className="size-3.5" />
            </button>
          </div>
          <button onClick={() => onChange(media.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-zinc-900/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button onClick={onAdd} className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 text-xs text-zinc-500 transition hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700">
        <ImagePlus className="size-5" />
        Медиа
      </button>
    </div>
  );
}

export default function Composer() {
  const { composer, closeComposer, channels, bump } = useStore();
  const toast = useToast();
  const editing = composer?.post;
  const active = channels.filter((c) => c.status === 'active' || c.id === editing?.channel_id);

  const [selected, setSelected] = useState<string[]>(() => (editing ? [editing.channel_id] : composer?.channelIds ?? (active.length === 1 ? [active[0].id] : [])));
  const [content, setContent] = useState(editing?.content ?? '');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<string>('all');
  const [media, setMedia] = useState<M[]>(editing?.media ?? composer?.media ?? []);
  const [ig, setIg] = useState(editing?.options.instagram ?? {});
  const [th, setTh] = useState<{ topic_tag?: string; reply_control?: any }>(() => {
    const { thread, ...rest } = editing?.options.threads ?? {};
    return rest;
  });
  const [parts, setParts] = useState<Part[]>(() => (editing?.options.threads?.thread ?? []).map((p) => ({ text: p.text, media: (p.media ?? []) as M[] })));
  const [when, setWhen] = useState(() => {
    if (editing?.scheduled_at) return toLocalInput(new Date(editing.scheduled_at));
    if (composer?.date) return toLocalInput(composer.date);
    return '';
  });
  const [picker, setPicker] = useState<null | 'main' | number>(null);
  const [previewCh, setPreviewCh] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sigs, setSigs] = useState<Signature[]>([]);
  const { upload } = useUpload();
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<Signature[]>('/api/signatures').then(setSigs).catch(() => {});
  }, []);

  const selChannels = selected.map((id) => channels.find((c) => c.id === id)).filter(Boolean) as Channel[];
  const providers = [...new Set(selChannels.map((c) => c.provider))];
  const textFor = (id: string) => custom[id] ?? content;

  const options: PostOptions = useMemo(
    () => ({
      instagram: providers.includes('instagram') ? ig : undefined,
      threads: providers.includes('threads') ? { ...th, thread: parts.filter((p) => p.text.trim() || p.media.length).map((p) => ({ text: p.text, media: p.media })) } : undefined,
    }),
    [ig, th, parts, providers.join()],
  );

  const errors = Object.fromEntries(selChannels.map((c) => [c.id, validate(c.provider, textFor(c.id), media, options)]));
  const hasErrors = Object.values(errors).some((e) => e.length);
  const pCh = selChannels.find((c) => c.id === previewCh) ?? selChannels[0];

  const editorText = tab === 'all' ? content : textFor(tab);
  const setEditorText = (v: string) => (tab === 'all' ? setContent(v) : setCustom((c) => ({ ...c, [tab]: v })));
  const tabProviders: Provider[] = tab === 'all' ? providers : [channels.find((c) => c.id === tab)!.provider];

  const insert = (s: string) => {
    const el = textRef.current;
    const cur = editorText;
    if (!el) return setEditorText(cur + s);
    const pos = el.selectionStart ?? cur.length;
    setEditorText(cur.slice(0, pos) + s + cur.slice(el.selectionEnd ?? pos));
  };

  const toggle = (id: string) => {
    if (editing) return setSelected([id]);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const pickMedia = (items: Media[]) => {
    const refs = items.map((m) => ({ id: m.id, kind: m.kind, url: m.url }));
    if (picker === 'main') setMedia((x) => [...x, ...refs]);
    else if (typeof picker === 'number') setParts((ps) => ps.map((p, i) => (i === picker ? { ...p, media: [...p.media, ...refs] } : p)));
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    const added = await upload(files);
    setMedia((x) => [...x, ...added.map((m) => ({ id: m.id, kind: m.kind, url: m.url }))]);
  };

  async function save(mode: 'draft' | 'schedule' | 'queue' | 'now') {
    if (!selChannels.length) return toast('error', 'Выберите канал');
    if (mode !== 'draft' && hasErrors) return toast('error', 'Исправьте ошибки перед публикацией');
    if (mode === 'schedule' && !when) return toast('error', 'Укажите дату и время');
    if (mode === 'schedule' && new Date(when).getTime() < Date.now()) return toast('error', 'Время уже прошло');
    if (mode === 'now' && !confirm(`Опубликовать сейчас в ${selChannels.map((c) => '@' + c.username).join(', ')}? Это нельзя отменить.`)) return;

    setBusy(mode);
    const mediaIds = media.map((m) => m.id);
    try {
      if (editing) {
        const ch = selChannels[0];
        let scheduled_at = fromLocalInput(when);
        if (mode === 'queue') scheduled_at = (await api.get<{ at: string }>(`/api/channels/${ch.id}/next-slot`)).at;
        await api.put(`/api/posts/${editing.id}`, {
          channel_id: ch.id,
          content: textFor(ch.id),
          media: mediaIds,
          options,
          scheduled_at,
          status: mode === 'schedule' || mode === 'queue' ? 'scheduled' : 'draft',
        });
        if (mode === 'now') {
          const r = await api.post<Post>(`/api/posts/${editing.id}/publish`);
          if (r.status === 'failed') throw new Error(r.error ?? 'Ошибка публикации');
        }
      } else if (mode === 'queue') {
        for (const ch of selChannels) {
          const { at } = await api.get<{ at: string }>(`/api/channels/${ch.id}/next-slot`);
          await api.post('/api/posts', { channel_ids: [ch.id], content: textFor(ch.id), media: mediaIds, options, scheduled_at: at, status: 'scheduled' });
        }
      } else {
        const overrides = Object.fromEntries(Object.entries(custom).filter(([id]) => selected.includes(id)));
        const res = await api.post<Post[]>('/api/posts', {
          channel_ids: selected,
          content,
          overrides,
          media: mediaIds,
          options,
          scheduled_at: fromLocalInput(when),
          status: mode === 'schedule' ? 'scheduled' : 'draft',
          publish_now: mode === 'now',
        });
        const failed = res.filter((p) => p.status === 'failed');
        if (failed.length) throw new Error(failed.map((p) => `@${p.channel?.username}: ${p.error}`).join('\n'));
      }
      toast('ok', { draft: 'Черновик сохранён', schedule: 'Пост запланирован', queue: 'Добавлено в очередь', now: 'Опубликовано!' }[mode]);
      bump();
      closeComposer();
    } catch (e: any) {
      toast('error', e.message);
      bump();
    } finally {
      setBusy(null);
    }
  }

  const ChannelPicker = (
    <div className="flex flex-wrap gap-2">
      {active.length === 0 && (
        <a href="#/channels" onClick={closeComposer} className="text-sm text-brand-600 underline">
          Сначала подключите канал →
        </a>
      )}
      {active.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={c.id}
            onClick={() => toggle(c.id)}
            title={`${c.provider}: @${c.username}`}
            className={cx('flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition', on ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/20' : 'border-zinc-200 opacity-60 hover:opacity-100 dark:border-zinc-700')}
          >
            <ChannelAvatar provider={c.provider} avatar={c.avatar_url} username={c.username} size={26} />
            <span className="font-medium">{c.username}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Modal open onClose={closeComposer} title={editing ? 'Редактирование поста' : 'Новый пост'} width="max-w-6xl">
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* ------------------------------ Editor ------------------------------ */}
        <div className="min-w-0 space-y-5">
          <div>
            <Label>Каналы</Label>
            {ChannelPicker}
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <button onClick={() => setTab('all')} className={cx('rounded-md px-2.5 py-1 text-xs font-medium', tab === 'all' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800')}>
                Общий текст
              </button>
              {!editing &&
                selChannels.length > 1 &&
                selChannels.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setTab(c.id)}
                    className={cx('flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium', tab === c.id ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
                  >
                    <ProviderIcon provider={c.provider} className="size-3" />
                    {custom[c.id] !== undefined && <PenLine className="size-3" />}@{c.username}
                  </button>
                ))}
            </div>
            {tab !== 'all' && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {custom[tab] !== undefined ? 'Для этого канала задан свой текст' : 'Начните печатать — текст станет отдельным для этого канала'}
                {custom[tab] !== undefined && (
                  <button
                    className="font-medium underline"
                    onClick={() =>
                      setCustom((c) => {
                        const { [tab]: _, ...rest } = c;
                        return rest;
                      })
                    }
                  >
                    Вернуть общий
                  </button>
                )}
              </div>
            )}
            <Textarea
              ref={textRef}
              rows={8}
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              onPaste={onPaste}
              placeholder="О чём расскажем? Вставьте картинку через Ctrl+V"
              className="text-[15px] leading-relaxed"
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                {sigs.length > 0 && (
                  <Select className="!h-7 w-auto !py-0 text-xs" value="" onChange={(e) => e.target.value && insert(e.target.value)}>
                    <option value="">+ Подпись</option>
                    {sigs.map((s) => (
                      <option key={s.id} value={'\n\n' + s.content}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
                {!sigs.length && (
                  <a href="#/settings" onClick={closeComposer} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-600">
                    <SigIcon className="size-3.5" /> Подписи
                  </a>
                )}
              </div>
              <div className="flex gap-3">
                {tabProviders.map((p) => (
                  <span key={p} className="flex items-center gap-1">
                    <span className="text-zinc-400">{LIMITS[p].label}</span> <Counter text={editorText} provider={p} />
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label hint={providers.includes('instagram') ? 'Instagram: картинки автоматически → JPEG' : undefined}>Медиа</Label>
            <MediaStrip media={media} onChange={setMedia} onAdd={() => setPicker('main')} />
          </div>

          {providers.includes('instagram') && (
            <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex size-5 items-center justify-center rounded bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600 text-white">
                  <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /></svg>
                </span>
                Instagram
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Формат</Label>
                  <Select value={ig.type ?? 'feed'} onChange={(e) => setIg({ ...ig, type: e.target.value as any })}>
                    <option value="feed">Пост / карусель</option>
                    <option value="reel">Reels</option>
                    <option value="story">Stories</option>
                  </Select>
                </div>
                {ig.type === 'reel' && (
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" checked={ig.share_to_feed ?? true} onChange={(e) => setIg({ ...ig, share_to_feed: e.target.checked })} />
                    Показывать в ленте
                  </label>
                )}
              </div>
              {ig.type !== 'story' && (
                <div>
                  <Label hint="например, хэштеги">Первый комментарий</Label>
                  <Textarea rows={2} value={ig.first_comment ?? ''} onChange={(e) => setIg({ ...ig, first_comment: e.target.value })} />
                </div>
              )}
            </div>
          )}

          {providers.includes('threads') && (
            <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex size-5 items-center justify-center rounded bg-zinc-900 text-[11px] font-bold text-white dark:bg-white dark:text-zinc-900">@</span>
                Threads
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Тема (topic)</Label>
                  <Input value={th.topic_tag ?? ''} placeholder="напр. Маркетинг" onChange={(e) => setTh({ ...th, topic_tag: e.target.value })} />
                </div>
                <div>
                  <Label>Кто может отвечать</Label>
                  <Select value={th.reply_control ?? 'everyone'} onChange={(e) => setTh({ ...th, reply_control: e.target.value })}>
                    <option value="everyone">Все</option>
                    <option value="accounts_you_follow">Те, на кого подписан</option>
                    <option value="mentioned_only">Только упомянутые</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-3">
                {parts.map((p, i) => (
                  <div key={i} className="rounded-lg border-l-2 border-zinc-300 pl-3 dark:border-zinc-600">
                    <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
                      <span>Продолжение #{i + 2}</span>
                      <span className="flex items-center gap-2">
                        <Counter text={p.text} provider="threads" />
                        <button onClick={() => setParts(parts.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-600">
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </div>
                    <Textarea rows={3} value={p.text} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                    <div className="mt-2">
                      <MediaStrip media={p.media} onChange={(m) => setParts(parts.map((x, j) => (j === i ? { ...x, media: m } : x)))} onAdd={() => setPicker(i)} />
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setParts([...parts, { text: '', media: [] }])}>
                  Добавить продолжение цепочки
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------ Preview ----------------------------- */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-200 p-2 dark:border-zinc-800">
              <span className="px-1.5 text-xs font-medium text-zinc-500">Превью</span>
              {selChannels.map((c) => (
                <button key={c.id} onClick={() => setPreviewCh(c.id)} className={cx('rounded-full p-0.5 ring-2', pCh?.id === c.id ? 'ring-brand-500' : 'ring-transparent')}>
                  <ChannelAvatar provider={c.provider} avatar={c.avatar_url} username={c.username} size={24} />
                </button>
              ))}
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-4">
              {pCh ? <Preview ch={pCh} text={textFor(pCh.id)} media={media} options={options} /> : <div className="py-10 text-center text-sm text-zinc-400">Выберите канал</div>}
            </div>
          </div>

          {selChannels.some((c) => errors[c.id]?.length) && (
            <div className="space-y-1 rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {selChannels.map((c) =>
                errors[c.id]?.map((e) => (
                  <div key={c.id + e} className="flex gap-1.5">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" /> @{c.username}: {e}
                  </div>
                )),
              )}
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div>
              <Label hint={Intl.DateTimeFormat().resolvedOptions().timeZone}>Дата и время публикации</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" icon={<Clock className="size-4" />} loading={busy === 'schedule'} disabled={!!busy} onClick={() => save('schedule')}>
                Запланировать
              </Button>
              <Button icon={<ListPlus className="size-4" />} loading={busy === 'queue'} disabled={!!busy} onClick={() => save('queue')} title="Ближайший свободный слот из расписания канала">
                В очередь
              </Button>
              <Button icon={<Save className="size-4" />} loading={busy === 'draft'} disabled={!!busy} onClick={() => save('draft')}>
                Черновик
              </Button>
              <Button icon={<Send className="size-4" />} loading={busy === 'now'} disabled={!!busy} onClick={() => save('now')}>
                Сейчас
              </Button>
            </div>
            {editing?.error && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                <Badge tone="red">Последняя ошибка</Badge> <div className="mt-1 whitespace-pre-line">{editing.error}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <MediaPicker open={picker !== null} onClose={() => setPicker(null)} onPick={pickMedia} />
    </Modal>
  );
}
