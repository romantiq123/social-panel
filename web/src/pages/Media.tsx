import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Copy, ImageIcon } from 'lucide-react';
import { api, type Media } from '../api';
import { Button, Empty, PageHeader, Spinner, useToast } from '../components/ui';
import { MediaThumb, useUpload } from '../components/MediaPicker';
import { useStore } from '../store';

export default function MediaPage() {
  const [items, setItems] = useState<Media[] | null>(null);
  const { upload, uploading } = useUpload();
  const toast = useToast();
  const { openComposer } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const load = () => api.get<Media[]>('/api/media').then(setItems);
  useEffect(() => {
    load();
  }, []);

  const onFiles = async (files: File[]) => {
    const r = await upload(files);
    if (r.length) toast('ok', `Загружено: ${r.length}`);
    load();
  };

  const remove = async (m: Media) => {
    if (!confirm('Удалить файл? Запланированные посты с ним не смогут опубликоваться.')) return;
    await api.del(`/api/media/${m.id}`);
    load();
  };

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
          <Button variant="primary" loading={uploading} icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>
            Загрузить
          </Button>
        }
      />
      <input ref={input} type="file" multiple accept="image/*,video/mp4,video/quicktime" hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />
      {drag && <div className="mb-4 rounded-xl border-2 border-dashed border-brand-500 bg-brand-50 p-10 text-center text-brand-700 dark:bg-brand-700/20">Отпустите, чтобы загрузить</div>}
      {!items ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Empty icon={<ImageIcon className="size-8" />} title="Библиотека пуста" text="Перетащите файлы сюда или нажмите «Загрузить»" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((m) => (
            <div key={m.id} className="group overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="relative aspect-square">
                <MediaThumb m={m} className="size-full" />
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/50 opacity-0 transition group-hover:opacity-100">
                  <Button size="sm" variant="primary" onClick={() => openComposer({ media: [{ id: m.id, kind: m.kind, url: m.url }] })}>
                    В пост
                  </Button>
                  <Button
                    size="sm"
                    icon={<Copy className="size-3.5" />}
                    title="Копировать публичный URL"
                    onClick={() => {
                      navigator.clipboard.writeText(m.public_url);
                      toast('ok', 'URL скопирован');
                    }}
                  />
                  <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => remove(m)} />
                </div>
              </div>
              <div className="truncate px-2 py-1.5 text-xs text-zinc-500" title={m.original_name ?? ''}>
                {m.original_name} · {(m.size / 1024 / 1024).toFixed(1)} МБ{m.width ? ` · ${m.width}×${m.height}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
