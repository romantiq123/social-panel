import { log } from './db.ts';
import { refreshDueTokens } from './channels.ts';
import { publishDue, recoverStuck, refreshRecentInsights } from './posts.ts';
import { getInternal, setInternal } from './settings.ts';

async function safe(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e: any) {
    await log('error', 'scheduler', `${name}: ${e.message}`);
  }
}

const HOUR = 3_600_000;

/** Выполняет задачу, если с прошлого запуска прошло больше `every` мс (отметка хранится в settings) */
async function every(key: string, everyMs: number, fn: () => Promise<unknown>) {
  const last = Number(getInternal(`last_${key}`) ?? 0);
  if (Date.now() - last < everyMs) return;
  await setInternal(`last_${key}`, String(Date.now()));
  await safe(key, fn);
}

/**
 * Один «тик» планировщика. На Vercel его раз в минуту дёргает pg_cron из Supabase (GET /api/cron/tick),
 * локально — setInterval в src/server/index.ts.
 */
export async function tick() {
  await safe('recover', recoverStuck);
  await safe('publish', publishDue);
  await every('tokens', 6 * HOUR, refreshDueTokens);
  await every('insights', 3 * HOUR, () => refreshRecentInsights());
}
