import { getSettings } from './settings.ts';

/** Смещение часового пояса (мс) в заданный момент */
function tzOffset(tz: string, at: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Локальное время в поясе tz → UTC timestamp */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess - tzOffset(tz, guess);
  ts = guess - tzOffset(tz, ts);
  return ts;
}

/**
 * Принимает ISO с оффсетом ("2026-10-01T19:00:00+05:00"), UTC ("...Z")
 * или «наивное» время ("2026-10-01 19:00") — последнее трактуется в поясе из настроек.
 */
export function parseWhen(input: string): string {
  const s = input.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error(`Не удалось разобрать дату: ${input}`);
    return new Date(t).toISOString();
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!m) throw new Error(`Формат даты: YYYY-MM-DD HH:mm или ISO 8601. Получено: ${input}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(zonedToUtc(y, mo, d, h, mi, getSettings().timezone)).toISOString();
}

/** UTC ISO → строка в поясе из настроек */
export function formatLocal(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: getSettings().timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** Части даты в поясе tz */
export function localParts(ts: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
  const [y, m, d] = parts.split('-').map(Number);
  return { y, m, d };
}
