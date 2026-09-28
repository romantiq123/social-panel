import { useEffect, useRef, useState } from 'react';
import { Upload, Film } from 'lucide-react';
import { api, type Media } from '../api';
import { Button, cx, Modal, Spinner, useToast } from './ui';

export function useUpload() {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const upload = async (files: File[]) => {
    if (!files.length) return [];
    setUploading(true);
    try {
      return await api.upload(files);
    } catch (e: any) {
      toast('error', e.message);
      return [];
    } finally {
      setUploading(false);
    }
  };
  return { upload, uploading };
}

export function MediaThumb({ m, className }: { m: { kind: 'image' | 'video'; url: string }; className?: string }) {
  return m.kind === 'video' ? (
    <div className={cx('relative bg-zinc-900', className)}>
      <video src={m.url} className="size-full object-cover" muted preload="metadata" />
      <Film className="absolute right-1.5 top-1.5 size-4 text-white drop-shadow" />
    </div>
  ) : (
    <img src={m.url} className={cx('object-cover', className)} alt="" loading="lazy" />
  );
}

export default function MediaPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (m: Media[]) => void }) {
  const [items, setItems] = useState<Media[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const { upload, uploading } = useUpload();
  const input = useRef<HTMLInputElement>(null);

  const load = () => api.get<Media[]>('/api/media').then(setItems);
  useEffect(() => {
    if (open) {
      setSelected([]);
      load();
    }
  }, [open]);

  const onFiles = async (files: File[]) => {
    const added = await upload(files);
    await load();
    setSelected((s) => [...s, ...added.map((a) => a.id)]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Библиотека медиа"
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={!selected.length}
            onClick={() => {
              onPick(selected.map((id) => items!.find((i) => i.id === id)!).filter(Boolean));
              onClose();
            }}
          >
            Добавить {selected.length ? `(${selected.length})` : ''}
          </Button>
        </>
      }
    >
      <div
        className="mb-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-zinc-300 p-6 text-sm text-zinc-500 transition hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFiles([...e.dataTransfer.files]);
        }}
      >
        {uploading ? <Spinner /> : <Upload className="mb-1.5 size-5" />}
        Перетащите файлы или нажмите, чтобы выбрать (JPG, PNG, WEBP, MP4, MOV)
        <input ref={input} type="file" multiple accept="image/*,video/mp4,video/quicktime" hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />
      </div>
      {!items ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-500">Библиотека пуста</div>
      ) : (
        <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {items.map((m) => {
            const idx = selected.indexOf(m.id);
            return (
              <button
                key={m.id}
                onClick={() => setSelected((s) => (idx >= 0 ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                className={cx('relative aspect-square overflow-hidden rounded-lg ring-2 transition', idx >= 0 ? 'ring-brand-500' : 'ring-transparent hover:ring-zinc-300')}
              >
                <MediaThumb m={m} className="size-full" />
                {idx >= 0 && (
                  <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
                    {idx + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

