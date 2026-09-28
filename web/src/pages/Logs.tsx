import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, type LogEntry } from '../api';
import { Button, Card, cx, PageHeader, Spinner, Tabs } from '../components/ui';

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [level, setLevel] = useState<'all' | 'error'>('all');
  const load = () => api.get<LogEntry[]>('/api/logs?limit=300').then(setLogs);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  const shown = logs?.filter((l) => level === 'all' || l.level !== 'info');

  return (
    <div>
      <PageHeader
        title="Журнал"
        subtitle="Публикации, обновления токенов и ошибки"
        actions={
          <>
            <Tabs value={level} onChange={setLevel} items={[{ value: 'all', label: 'Все' }, { value: 'error', label: 'Проблемы' }]} />
            <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={load} />
          </>
        }
      />
      {!shown ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <Card className="divide-y divide-zinc-100 font-mono text-xs dark:divide-zinc-800">
          {shown.length === 0 && <div className="p-6 text-center font-sans text-sm text-zinc-500">Пусто</div>}
          {shown.map((l) => (
            <div key={l.id} className="flex gap-3 px-4 py-2">
              <span className="shrink-0 text-zinc-400">{new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className={cx('w-12 shrink-0 font-semibold uppercase', l.level === 'error' ? 'text-red-600' : l.level === 'warn' ? 'text-amber-600' : 'text-emerald-600')}>{l.level}</span>
              <span className="w-20 shrink-0 text-zinc-500">{l.source}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{l.message}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
