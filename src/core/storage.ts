import './paths.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Файлы медиа — в Supabase Storage (публичный бакет), откуда их скачивают сервера Meta.
 * SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY даёт интеграция Supabase ↔ Vercel.
 */
export const BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'media';

let client: SupabaseClient | null = null;
export function storage() {
  if (!client) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('Не заданы SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client.storage;
}

let bucketReady: Promise<void> | null = null;
export function ensureBucket() {
  bucketReady ??= (async () => {
    const s = storage();
    const { data } = await s.getBucket(BUCKET);
    if (!data) {
      const { error } = await s.createBucket(BUCKET, { public: true, fileSizeLimit: '50MB' });
      if (error && !/already exists/i.test(error.message)) throw error;
    }
  })().catch((e) => {
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

export function publicFileUrl(filename: string) {
  return storage().from(BUCKET).getPublicUrl(filename).data.publicUrl;
}

export async function putFile(filename: string, data: Buffer, contentType: string) {
  await ensureBucket();
  const { error } = await storage().from(BUCKET).upload(filename, data, { contentType, upsert: true, cacheControl: '86400' });
  if (error) throw new Error(`Storage: ${error.message}`);
}

export async function getFile(filename: string): Promise<Buffer> {
  const { data, error } = await storage().from(BUCKET).download(filename);
  if (error || !data) throw new Error(`Storage: не удалось скачать ${filename}: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeFile(filename: string) {
  await storage().from(BUCKET).remove([filename]);
}

/** Подписанный URL для прямой загрузки из браузера (минуя лимит тела запроса Vercel 4.5 МБ) */
export async function signedUpload(filename: string) {
  await ensureBucket();
  const { data, error } = await storage().from(BUCKET).createSignedUploadUrl(filename, { upsert: true });
  if (error || !data) throw new Error(`Storage: ${error?.message}`);
  return data; // { signedUrl, token, path }
}
