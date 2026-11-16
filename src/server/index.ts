// Локальный запуск (npm start / npm run dev): тот же app + раздача собранного UI + планировщик по таймеру.
// На Vercel вместо этого файла работает api/index (см. scripts/build-vercel.mjs), а тики шлёт cron.
import '../core/paths.ts';
import { serve } from '@hono/node-server';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { ROOT } from '../core/paths.ts';
import { ensureSchema } from '../core/db.ts';
import { getSettings, loadSettings } from '../core/settings.ts';
import { tick } from '../core/scheduler.ts';
import { ensurePassword, initAuth } from './auth.ts';
import { app } from './app.ts';

const WEB = join(ROOT, 'dist', 'web');
app.get('*', async (c) => {
  if (!existsSync(WEB)) return c.text('UI не собран. Запустите `npm run build` или `npm run dev` (UI на :5173).', 404);
  const p = new URL(c.req.url).pathname;
  const file = join(WEB, p.replace(/\.\.+/g, ''));
  if (p !== '/' && existsSync(file) && statSync(file).isFile()) {
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon' };
    return new Response(await readFile(file), { headers: { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' } });
  }
  return c.html(await readFile(join(WEB, 'index.html'), 'utf8'));
});

await ensureSchema();
await loadSettings();
await initAuth();

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => {
  console.error(`\n  Social Panel → http://localhost:${port}`);
  if (!process.env.PANEL_PASSWORD) console.error(`  Пароль панели: ${ensurePassword()}  (задайте PANEL_PASSWORD в .env, чтобы сменить)`);
  const base = getSettings().public_base_url;
  console.error(`  Публичный URL: ${base || '— не задан (Настройки)'}\n`);
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await loadSettings();
      await tick();
    } finally {
      busy = false;
    }
  }, 30_000);
});
