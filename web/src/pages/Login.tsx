import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../api';
import { Button, Card, Input } from '../components/ui';

export default function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/api/login', { password });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Lock className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">Social Panel</h1>
          <p className="mt-1 text-sm text-zinc-500">Threads + Instagram через официальные API</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Input type="password" autoFocus placeholder="Пароль панели" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <Button variant="primary" className="w-full" loading={loading}>
            Войти
          </Button>
          <p className="text-center text-xs text-zinc-400">Пароль выводится в консоли сервера или задаётся в .env (PANEL_PASSWORD)</p>
        </form>
      </Card>
    </div>
  );
}
