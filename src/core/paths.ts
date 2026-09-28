import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

// node:sqlite помечен как experimental — прячем это предупреждение
const emit = process.emitWarning.bind(process);
process.emitWarning = ((w: string | Error, ...rest: any[]) => {
  if (String(w).includes('SQLite')) return;
  return (emit as any)(w, ...rest);
}) as typeof process.emitWarning;

/** Корень проекта — не зависит от cwd (MCP может запускаться откуда угодно) */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
