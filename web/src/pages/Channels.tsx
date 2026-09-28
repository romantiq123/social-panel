import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Trash2, Plus, X, Clock, Gauge, AlertTriangle, Radio, Link2 } from 'lucide-react';
import { api, fmtDateTime, type Channel, type Provider } from '../api';
import { navigate, useRoute, useStore } from '../store';
import { Badge, Button, Card, ChannelAvatar, Empty, Label, Modal, PageHeader, PROVIDER_COLOR, ProviderIcon, Select, Textarea, cx, useToast } from '../components/ui';

function TokenBar({ c }: { c: Channel }) {
  const days = c.token_days_left ?? 0;
  const pct = Math.max(0, Math.min(100, (days / 60) * 100));
  const tone = c.status !== 'active' || days < 3 ? 'bg-red-500' : days < 10 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-zinc-500">
        <span>Токен</span>
        <span className="tabular-nums">{c.status === 'expired' ? 'истёк' : `${days} дн. осталось`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={cx('h-full rounded-full transition-all', tone)} style={{ width: `${c.status === 'expired' ? 100 : pct}%` }} />
      </div>
    </div>
  );
}

function SlotsEditor({ c, onSaved }: { c: Channel; onSaved: () => void }) {
  const [slots, setSlots] = useState(c.time_slots);
  const [add, setAdd] = useState('12:00');
  const toast = useToast();
  const save = async (next: string[]) => {
    setSlots(next);
    try {
      await api.patch(`/api/channels/${c.id}`, { time_slots: next });
      onSaved();
    } catch (e: any) {
      toast('error', e.message);
    }
  };
  return (
    <div>
      <Label hint="для кнопки «В очередь»">Слоты публикации</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {slots.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2 pr-1 text-xs tabular-nums dark:bg-zinc-800">
            {s}
            <button onClick={() => save(slots.filter((x) => x !== s))} className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <input type="time" value={add} onChange={(e) => setAdd(e.target.value)} className="h-6 rounded border border-zinc-200 bg-transparent px-1 text-xs dark:border-zinc-700" />
          <button onClick={() => add && !slots.includes(add) && save([...slots, add].sort())} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <Plus className="size-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}

function ChannelCard({ c }: { c: Channel }) {
  const { reloadChannels } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [limits, setLimits] = useState<{ used: number; total: number } | null>(null);

  const refresh = async () => {
    setBusy('refresh');
    try {
      await api.post(`/api/channels/${c.id}/refresh`);
      toast('ok', `Токен @${c.username} обновлён на 60 дней`);
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setBusy(null);
      reloadChannels();
    }
  };
  const loadLimits = async () => {
    setBusy('limits');
    try {
      setLimits(await api.get(`/api/channels/${c.id}/limits`));
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!confirm(`Отключить @${c.username}? Все его посты в панели будут удалены.`)) return;
    await api.del(`/api/channels/${c.id}`);
    reloadChannels();
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <ChannelAvatar provider={c.provider} avatar={c.avatar_url} username={c.username} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.name || c.username}</div>
          <div className="text-sm text-zinc-500">
            @{c.username} · {c.provider === 'threads' ? 'Threads' : 'Instagram'}
          </div>
          {c.followers_count != null && <div className="mt-0.5 text-xs text-zinc-500">{c.followers_count.toLocaleString('ru-RU')} подписчиков</div>}
        </div>
        <Badge tone={c.status === 'active' ? 'green' : 'red'}>{c.status === 'active' ? 'Активен' : c.status === 'expired' ? 'Токен истёк' : 'Ошибка'}</Badge>
      </div>

      {c.last_error && (
        <div className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="size-4 shrink-0" />
          {c.last_error}
        </div>
      )}

      <TokenBar c={c} />
      <div className="-mt-2 text-xs text-zinc-400">
        Обновлён {fmtDateTime(c.token_refreshed_at)} · истекает {fmtDateTime(c.token_expires_at)} · {c.token_preview}
      </div>

      <SlotsEditor c={c} onSaved={reloadChannels} />

      {limits && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>Лимит публикаций за 24 ч</span>
            <span className="tabular-nums">
              {limits.used}/{limits.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(limits.used / limits.total) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        {c.status === 'expired' ? (
          <a href={`/oauth/${c.provider}/start`}>
            <Button size="sm" variant="primary" icon={<Link2 className="size-4" />}>
              Переподключить
            </Button>
          </a>
        ) : (
          <Button size="sm" loading={busy === 'refresh'} icon={<RefreshCw className="size-4" />} onClick={refresh}>
            Обновить токен
          </Button>
        )}
        <Button size="sm" variant="ghost" loading={busy === 'limits'} icon={<Gauge className="size-4" />} onClick={loadLimits}>
          Лимиты
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-red-600" icon={<Trash2 className="size-4" />} onClick={remove} />
      </div>
    </Card>
  );
}

function TokenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [provider, setProvider] = useState<Provider>('threads');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { reloadChannels } = useStore();
  const submit = async () => {
    setBusy(true);
    try {
      const c = await api.post<Channel>('/api/channels/token', { provider, token });
      toast('ok', `Подключён @${c.username}`);
      setToken('');
      reloadChannels();
      onClose();
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Подключить по токену"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} disabled={!token.trim()} onClick={submit}>
            Подключить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">
          Удобно, пока нет HTTPS-туннеля. Сгенерируйте токен в Meta for Developers (Use cases → API setup → «Generate token» для тестового аккаунта). Короткий токен будет автоматически обменян на
          долгоживущий (60 дней), дальше панель сама продлевает его.
        </p>
        <div>
          <Label>Платформа</Label>
          <Select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="threads">Threads</option>
            <option value="instagram">Instagram</option>
          </Select>
        </div>
        <div>
          <Label>Access token</Label>
          <Textarea rows={4} value={token} onChange={(e) => setToken(e.target.value)} placeholder={provider === 'threads' ? 'THAA…' : 'IGAA…'} className="font-mono text-xs" />
        </div>
      </div>
    </Modal>
  );
}

export default function ChannelsPage() {
  const { channels, reloadChannels } = useStore();
  const { query } = useRoute();
  const toast = useToast();
  const [tokenModal, setTokenModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const u = query.get('connected');
    if (u) {
      toast('ok', `Канал @${u} подключён`);
      reloadChannels();
      navigate('/channels');
    }
  }, [query.get('connected')]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const r = await api.post<{ username: string; ok: boolean; error?: string }[]>('/api/channels/refresh-all');
      toast(r.some((x) => !x.ok) ? 'error' : 'ok', r.length ? r.map((x) => `@${x.username}: ${x.ok ? 'ок' : x.error}`).join('\n') : 'Все токены свежие — обновлять нечего');
      reloadChannels();
    } finally {
      setRefreshing(false);
    }
  };

  const ConnectButtons = (
    <>
      {(['threads', 'instagram'] as Provider[]).map((p) => (
        <a key={p} href={`/oauth/${p}/start`}>
          <Button icon={<span className={cx('flex size-5 items-center justify-center rounded', PROVIDER_COLOR[p])}><ProviderIcon provider={p} className="size-3" /></span>}>
            {p === 'threads' ? 'Threads' : 'Instagram'}
          </Button>
        </a>
      ))}
      <Button icon={<KeyRound className="size-4" />} onClick={() => setTokenModal(true)}>
        По токену
      </Button>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Каналы"
        subtitle={
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" /> Токены живут 60 дней и продлеваются автоматически за N дней до истечения (Настройки)
          </span>
        }
        actions={
          <>
            {ConnectButtons}
            {channels.length > 0 && (
              <Button variant="ghost" loading={refreshing} icon={<RefreshCw className="size-4" />} onClick={refreshAll}>
                Продлить все
              </Button>
            )}
          </>
        }
      />
      {channels.length === 0 ? (
        <Empty
          icon={<Radio className="size-8" />}
          title="Нет подключённых каналов"
          text="Подключите Threads или Instagram через OAuth (нужен HTTPS-адрес в Настройках) либо вставьте токен из Meta for Developers."
          action={<div className="flex flex-wrap justify-center gap-2">{ConnectButtons}</div>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((c) => (
            <ChannelCard key={c.id} c={c} />
          ))}
        </div>
      )}
      <TokenModal open={tokenModal} onClose={() => setTokenModal(false)} />
    </div>
  );
}

