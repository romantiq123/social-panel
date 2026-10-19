import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Copy, ImageIcon, CheckSquare, X, Plus, Check } from 'lucide-react';
import { api, ApiError, type Media } from '../api';
import { Badge, Button, cx, Empty, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { MediaThumb, useUpload } from '../components/MediaPicker';
import { useStore } from '../store';

type MediaItem = Media & { used_in: number };
type Filter = 'all' | 'unused' | 'used';

export default function MediaPage() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const { upload, uploading } = useUpload();
  const toast = useToast();
  const { openComposer, bump } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);

  const load = () => api.get<MediaItem[]>('/api/media').then(setItems);
  useEffect(() => {
    load();
  }, []);

  const onFiles = async (files: File[]) => {
    const r = await upload(files);
    if (r.length) toast('ok', `Загружено: ${r.length}`);
    load();
  };

  const exitSelect = () => {
    setSelecting(false);
    setSelected([]);
  };

  /** Удаляет файлы; если какие-то нужны постам — один раз спрашивает, убрать ли их из постов */
  const remove = async (list: MediaItem[]) => {
    if (!list.length) return;
    const used = list.filter((m) => m.used_in > 0);
    const msg =
      list.length === 1 ? `Удалить «${list[0].original_name ?? 'файл'}»?` : `Удалить файлов: ${list.length}?`;
    const usedMsg = used.length
      ? `\n\n${used.length === 1 ? 'Этот файл используется' : `${used.length} из них используются`} в неопубликованных постах — ${used.length === 1 ? 'он будет убран' : 'они будут убраны'} из этих постов.`
      : '';
    if (!confirm(msg + usedMsg)) return;
    setBusy(true);
    let ok = 0;
    const errors: string[] = [];
    for (const m of list) {
      try {
        await api.del(`/api/media/${m.id}${m.used_in ? '?force=1' : ''}`);
        ok++;
      } catch (e) {
        // счётчик мог устареть — файл успели добавить в пост
        if (e instanceof ApiError && e.status === 409 && confirm(`${e.message}\n\nВсё равно удалить?`)) {
          await api.del(`/api/media/${m.id}?force=1`);
          ok++;
        } else errors.push(`${m.original_name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (ok) toast('ok', `Удалено: ${ok}`);
    if (errors.length) toast('error', errors.join('\n'));
    exitSelect();
    load();
    if (used.length) bump();
  };

  const shown = items?.filter((m) => filter === 'all' || (filter === 'used' ? m.used_in > 0 : m.used_in === 0)) ?? [];
  const unusedCount = items?.filter((m) => m.used_in === 0).length ?? 0;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selItems = (items ?? []).filter((m) => selected.includes(m.id));

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <PageHeader
        title="Медиа"
        subtitle="Картинки автоматически конвертируются в JPEG (требование Instagram). Видео — MP4/MOV."
        actions={
          <>
            {items && items.length > 0 && !selecting && (
              <Button icon={<CheckSquare className="size-4" />} onClick={() => setSelecting(true)}>
                Выбрать
              </Button>
            )}
            <Button variant="primary" loading={uploading} icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>
              Загрузить
            </Button>
          </>
        }
      />
      <input ref={input} type="file" multiple accept="image/*,video/mp4,video/quicktime" hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />

      {items && items.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: `Все · ${items.length}` },
              { value: 'unused', label: `Не используются · ${unusedCount}` },
              { value: 'used', label: `В постах · ${items.length - unusedCount}` },
            ]}
          />
        </div>
      )}

      {selecting && (
        <div className="sticky top-14 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-white p-2.5 shadow-sm lg:top-2 dark:bg-zinc-900">
          <span className="px-1.5 text-sm font-medium">Выбрано: {selected.length}</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(shown.map((m) => m.id))}>
            Все на экране
          </Button>
          {filter !== 'unused' && unusedCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected((items ?? []).filter((m) => m.used_in === 0).map((m) => m.id))}>
              Неиспользуемые
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              icon={<Plus className="size-4" />}
              disabled={!selected.length}
              onClick={() => {
                openComposer({ media: selItems.map((m) => ({ id: m.id, kind: m.kind, url: m.url })) });
                exitSelect();
              }}
            >
              В пост
            </Button>
            <Button size="sm" variant="danger" loading={busy} disabled={!selected.length} icon={<Trash2 className="size-4" />} onClick={() => remove(selItems)}>
              Удалить
            </Button>
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={exitSelect} title="Отмена" />
          </div>
        </div>
      )}

      {drag && <div className="mb-4 rounded-xl border-2 border-dashed border-brand-500 bg-brand-50 p-10 text-center text-brand-700 dark:bg-brand-700/20">Отпустите, чтобы загрузить</div>}
      {!items ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Empty icon={<ImageIcon className="size-8" />} title="Библиотека пуста" text="Перетащите файлы сюда или нажмите «Загрузить»" />
      ) : shown.length === 0 ? (
        <Empty title="Нет файлов в этом фильтре" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {shown.map((m) => {
            const on = selected.includes(m.id);
            return (
              <div
                key={m.id}
                className={cx(
                  'group overflow-hidden rounded-xl border bg-white transition dark:bg-zinc-900',
                  on ? 'border-brand-500 ring-2 ring-brand-500' : 'border-zinc-200 dark:border-zinc-800',
                )}
              >
                <div className={cx('relative aspect-square', selecting && 'cursor-pointer')} onClick={() => selecting && toggle(m.id)}>
                  <MediaThumb m={m} className="size-full" />
                  {selecting && (
                    <span
                      className={cx(
                        'absolute left-2 top-2 flex size-6 items-center justify-center rounded-md border-2 transition',
                        on ? 'border-brand-600 bg-brand-600 text-white' : 'border-white bg-black/30',
                      )}
                    >
                      {on && <Check className="size-4" />}
                    </span>
                  )}
                  {m.used_in > 0 && (
                    <span className="absolute right-2 top-2">
                      <Badge tone="brand">в {m.used_in} {m.used_in === 1 ? 'посте' : 'постах'}</Badge>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <div className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={m.original_name ?? ''}>
                    {m.original_name} · {(m.size / 1024 / 1024).toFixed(1)} МБ{m.width ? ` · ${m.width}×${m.height}` : ''}
                  </div>
                  {!selecting && (
                    <>
                      <button
                        title="В пост"
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                        onClick={() => openComposer({ media: [{ id: m.id, kind: m.kind, url: m.url }] })}
                      >
                        <Plus className="size-3.5" />
                      </button>
                      <button
                        title="Копировать публичный URL"
                        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                        onClick={() => {
                          navigator.clipboard.writeText(m.public_url);
                          toast('ok', 'URL скопирован');
                        }}
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <button title="Удалить" className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950" onClick={() => remove([m])}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
