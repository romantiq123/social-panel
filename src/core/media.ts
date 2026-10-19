import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { db, log, now, uid, UPLOAD_DIR } from './db.ts';
import { getSettings } from './settings.ts';
import type { MediaRef } from './types.ts';

export interface MediaRow {
  id: string;
  filename: string;
  original_name: string | null;
  mime: string;
  kind: 'image' | 'video';
  size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

const VIDEO_EXT: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
const IMAGE_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.avif': 'image/avif',
};

let sharpMod: any | null | undefined;
async function getSharp() {
  if (sharpMod === undefined) {
    try {
      sharpMod = (await import('sharp')).default;
    } catch {
      sharpMod = null;
    }
  }
  return sharpMod;
}

export function mediaUrl(m: Pick<MediaRow, 'filename'>) {
  const base = getSettings().public_base_url;
  return `${base}/media/${m.filename}`;
}

export function publicMedia(m: MediaRow) {
  return { ...m, url: `/media/${m.filename}`, public_url: mediaUrl(m) };
}

/**
 * Сохраняет файл в библиотеку.
 * Instagram принимает только JPEG, поэтому любые картинки конвертируются в JPEG (макс. 1440px по ширине).
 */
export async function saveMedia(buf: Buffer, originalName: string, mimeHint?: string): Promise<MediaRow> {
  const ext = extname(originalName).toLowerCase();
  const isVideo = mimeHint?.startsWith('video/') || ext in VIDEO_EXT;
  const isImage = mimeHint?.startsWith('image/') || ext in IMAGE_EXT;
  if (!isVideo && !isImage) throw new Error(`Неподдерживаемый тип файла: ${originalName}. Нужны JPG/PNG/WEBP или MP4/MOV`);

  const id = uid();
  let filename: string;
  let mime: string;
  let width: number | null = null;
  let height: number | null = null;
  let data = buf;

  if (isImage) {
    const sharp = await getSharp();
    if (sharp) {
      const img = sharp(buf, { failOn: 'none' }).rotate();
      const meta = await img.metadata();
      const needResize = (meta.width ?? 0) > 1440;
      const pipeline = needResize ? img.resize({ width: 1440 }) : img;
      const out = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      data = out.data;
      width = out.info.width;
      height = out.info.height;
      filename = `${id}.jpg`;
      mime = 'image/jpeg';
    } else {
      filename = `${id}${ext || '.jpg'}`;
      mime = IMAGE_EXT[ext] ?? mimeHint ?? 'image/jpeg';
    }
  } else {
    filename = `${id}${ext || '.mp4'}`;
    mime = VIDEO_EXT[ext] ?? mimeHint ?? 'video/mp4';
  }

  await writeFile(join(UPLOAD_DIR, filename), data);
  const row: MediaRow = {
    id,
    filename,
    original_name: originalName,
    mime,
    kind: isVideo ? 'video' : 'image',
    size: data.length,
    width,
    height,
    created_at: now(),
  };
  db.prepare('INSERT INTO media (id, filename, original_name, mime, kind, size, width, height, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
    row.id,
    row.filename,
    row.original_name,
    row.mime,
    row.kind,
    row.size,
    row.width,
    row.height,
    row.created_at,
  );
  log('info', 'media', `Загружен файл ${originalName} (${Math.round(row.size / 1024)} КБ)`);
  return row;
}

/** Импорт из URL или локального пути (используется MCP) */
export async function importMedia(source: string): Promise<MediaRow> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Не удалось скачать ${source}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const name = basename(new URL(source).pathname) || 'download';
    return saveMedia(buf, name, res.headers.get('content-type') ?? undefined);
  }
  if (!existsSync(source)) throw new Error(`Файл не найден: ${source}`);
  return saveMedia(await readFile(source), basename(source));
}

export function listMedia(): MediaRow[] {
  return db.prepare('SELECT * FROM media ORDER BY created_at DESC').all() as unknown as MediaRow[];
}

export function getMedia(id: string): MediaRow {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRow | undefined;
  if (!m) throw new Error(`Медиа не найдено: ${id}`);
  return m;
}

export function toRefs(ids: string[]): MediaRef[] {
  return ids.map((id) => {
    const m = getMedia(id);
    return { id: m.id, kind: m.kind };
  });
}

/** Неопубликованные посты, которые используют файл (в основном медиа или в частях цепочки) */
export function mediaUsage(id: string) {
  return db
    .prepare(
      `SELECT p.id, p.status, p.scheduled_at, p.content, c.provider, c.username FROM posts p JOIN channels c ON c.id = p.channel_id
       WHERE p.status IN ('draft','scheduled','publishing','failed') AND (p.media LIKE ? OR p.options LIKE ?)`,
    )
    .all(`%${id}%`, `%${id}%`) as { id: string; status: string; scheduled_at: string | null; content: string; provider: string; username: string }[];
}

export class MediaInUseError extends Error {
  usage: ReturnType<typeof mediaUsage>;
  constructor(usage: ReturnType<typeof mediaUsage>) {
    super(
      `Файл используется в ${usage.length} неопубликованн${usage.length === 1 ? 'ом посте' : 'ых постах'}: ` +
        usage.map((u) => `${u.provider}:@${u.username} (${u.status})`).join(', ') +
        '. Удалите с force, чтобы убрать его и из этих постов.',
    );
    this.usage = usage;
  }
}

/**
 * Удаляет файл. Если он нужен неопубликованным постам — по умолчанию отказ;
 * с force файл удаляется и вычищается из этих постов. Опубликованным постам файл уже не нужен.
 */
export async function deleteMedia(id: string, opts: { force?: boolean } = {}) {
  const m = getMedia(id);
  const usage = mediaUsage(id);
  if (usage.some((u) => u.status === 'publishing')) throw new Error('Файл прямо сейчас публикуется — попробуйте через минуту');
  if (usage.length && !opts.force) throw new MediaInUseError(usage);
  for (const u of usage) {
    const row = db.prepare('SELECT media, options FROM posts WHERE id = ?').get(u.id) as { media: string; options: string };
    const media = (JSON.parse(row.media) as MediaRef[]).filter((x) => x.id !== id);
    const options = JSON.parse(row.options);
    for (const part of options.threads?.thread ?? []) part.media = (part.media ?? []).filter((x: MediaRef) => x.id !== id);
    db.prepare('UPDATE posts SET media = ?, options = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(media), JSON.stringify(options), now(), u.id);
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  log('info', 'media', `Удалён файл ${m.original_name ?? m.filename}${usage.length ? ` (убран из постов: ${usage.length})` : ''}`);
  try {
    await unlink(join(UPLOAD_DIR, m.filename));
  } catch {}
}
