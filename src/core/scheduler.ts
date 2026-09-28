import { log } from './db.ts';
import { refreshDueTokens } from './channels.ts';
import { publishDue, recoverStuck, refreshRecentInsights } from './posts.ts';

let busy = false;

async function safe(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e: any) {
    log('error', 'scheduler', `${name}: ${e.message}`);
  }
}

export function startScheduler() {
  recoverStuck();

  // Публикация по расписанию — каждые 20 сек
  setInterval(async () => {
    if (busy) return;
    busy = true;
    await safe('publish', publishDue);
    busy = false;
  }, 20_000);

  // Токены — при старте и каждые 6 часов
  const tokens = () => safe('tokens', refreshDueTokens);
  setTimeout(tokens, 5_000);
  setInterval(tokens, 6 * 3_600_000);

  // Статистика — раз в 3 часа
  setInterval(() => safe('insights', () => refreshRecentInsights()), 3 * 3_600_000);

  log('info', 'scheduler', 'Планировщик запущен');
}
