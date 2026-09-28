import { useEffect, useState } from 'react';
import { Copy, Save, Trash2, Plus, CheckCircle2, Circle, Bot, Globe, KeyRound, Signature as SigIcon } from 'lucide-react';
import { api, type Signature } from '../api';
import { useStore } from '../store';
import { Button, Card, Input, Label, Select, Textarea, useToast } from '../components/ui';

interface SettingsResp {
  settings: Record<string, any>;
  redirect_uris: { threads: string; instagram: string };
  uninstall_uris: { threads: string; instagram: string };
  project_root: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          icon={<Copy className="size-4" />}
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast('ok', 'Скопировано');
          }}
        />
      </div>
    </div>
  );
}

function Section({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">{icon}</div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {desc && <div className="mt-0.5 text-sm text-zinc-500">{desc}</div>}
        </div>
      </div>
      {children}
    </Card>
  );
}

const Step = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
  <li className="flex gap-2.5">
    {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 size-4 shrink-0 text-zinc-300" />}
    <span className={done ? 'text-zinc-500' : ''}>{children}</span>
  </li>
);

export default function SettingsPage() {
  const toast = useToast();
  const { channels } = useStore();
  const [data, setData] = useState<SettingsResp | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [sigs, setSigs] = useState<Signature[]>([]);
  const [sig, setSig] = useState({ name: '', content: '' });
  const [mcp, setMcp] = useState<{ token: string; from_env?: boolean } | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string | null; redirect_uris: string[]; created_at: string; last_used_at: string | null }[]>([]);
  const loadClients = () => api.get<typeof clients>('/api/mcp-clients').then(setClients).catch(() => {});

  const load = () =>
    api.get<SettingsResp>('/api/settings').then((d) => {
      setData(d);
      setForm(d.settings);
    });
  const loadSigs = () => api.get<Signature[]>('/api/signatures').then(setSigs);
  useEffect(() => {
    load();
    loadSigs();
    api.get<{ token: string; from_env: boolean }>('/api/mcp-token').then(setMcp).catch(() => {});
    loadClients();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings', form);
      await load();
      toast('ok', 'Настройки сохранены');
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  if (!data) return null;
  const s = data.settings;
  const https = /^https:\/\//.test(s.public_base_url);
  const root = data.project_root.replace(/\\/g, '/');
  const nodeArgs = ['--disable-warning=ExperimentalWarning', `${root}/node_modules/tsx/dist/cli.mjs`, `${root}/src/mcp/index.ts`];
  const mcpCmd = `claude mcp add social-panel --scope user -- node ${nodeArgs.map((a) => `"${a}"`).join(' ')}`;
  const desktopJson = JSON.stringify(
    { mcpServers: { 'social-panel': { command: 'node', args: nodeArgs } } },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Настройки</h1>
        <Button variant="primary" loading={saving} icon={<Save className="size-4" />} onClick={save}>
          Сохранить
        </Button>
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="mb-3 font-semibold">Чек-лист запуска</h2>
        <ol className="space-y-2 text-sm">
          <Step done={https}>
            Публичный HTTPS-адрес панели (туннель). Нужен, чтобы Meta скачивала ваши медиа и для OAuth. Быстро: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">cloudflared tunnel --url http://localhost:3001</code>
          </Step>
          <Step done={!!(s.threads_app_id || s.instagram_app_id)}>
            Приложение в <a className="text-brand-600 underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">Meta for Developers</a> с use case «Access the Threads API» и/или «Instagram API (Instagram login)», ключи ниже
          </Step>
          <Step done={!!(s.threads_app_id || s.instagram_app_id) && https}>Redirect URI из этой страницы добавлены в настройки приложения Meta</Step>
          <Step done={channels.length > 0}>Подключён хотя бы один канал (Каналы)</Step>
        </ol>
      </Card>

      <Section icon={<Globe className="size-4" />} title="Публичный адрес" desc="Используется для OAuth-колбэков и ссылок на медиа, которые скачивают сервера Meta">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>PUBLIC_BASE_URL</Label>
            <Input value={form.public_base_url ?? ''} onChange={set('public_base_url')} placeholder="https://my-panel.trycloudflare.com" />
          </div>
          <div>
            <Label hint="для MCP и «наивных» дат">Часовой пояс</Label>
            <Select value={form.timezone} onChange={set('timezone')}>
              {['Asia/Almaty', 'Asia/Aqtobe', 'Asia/Tashkent', 'Europe/Moscow', 'Europe/Kyiv', 'Europe/Berlin', 'Asia/Dubai', 'UTC'].map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label hint="макс. 59">Продлевать токен за N дней</Label>
            <Input type="number" min={1} max={59} value={form.refresh_days_before ?? 10} onChange={set('refresh_days_before')} />
          </div>
        </div>
      </Section>

      <Section icon={<KeyRound className="size-4" />} title="Приложение Meta" desc="App Dashboard → Use cases → Customize → Settings. У Threads и Instagram отдельные App ID/Secret.">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="text-sm font-semibold">Threads</div>
            <div>
              <Label>Threads App ID</Label>
              <Input value={form.threads_app_id ?? ''} onChange={set('threads_app_id')} />
            </div>
            <div>
              <Label>Threads App Secret</Label>
              <Input type="password" value={form.threads_app_secret ?? ''} onChange={set('threads_app_secret')} onFocus={(e) => e.target.value.startsWith('••') && setForm({ ...form, threads_app_secret: '' })} />
            </div>
            <CopyField label="Redirect Callback URL" value={data.redirect_uris.threads} />
            <CopyField label="Uninstall Callback URL" value={data.uninstall_uris.threads} />
          </div>
          <div className="space-y-3">
            <div className="text-sm font-semibold">Instagram</div>
            <div>
              <Label>Instagram App ID</Label>
              <Input value={form.instagram_app_id ?? ''} onChange={set('instagram_app_id')} />
            </div>
            <div>
              <Label>Instagram App Secret</Label>
              <Input type="password" value={form.instagram_app_secret ?? ''} onChange={set('instagram_app_secret')} onFocus={(e) => e.target.value.startsWith('••') && setForm({ ...form, instagram_app_secret: '' })} />
            </div>
            <CopyField label="OAuth Redirect URI" value={data.redirect_uris.instagram} />
            <CopyField label="Deauthorize Callback URL" value={data.uninstall_uris.instagram} />
          </div>
        </div>
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-zinc-500">Версии Graph API</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Threads</Label>
              <Input value={form.graph_version_threads ?? ''} onChange={set('graph_version_threads')} />
            </div>
            <div>
              <Label>Instagram</Label>
              <Input value={form.graph_version_instagram ?? ''} onChange={set('graph_version_instagram')} />
            </div>
          </div>
        </details>
      </Section>

      <Section icon={<SigIcon className="size-4" />} title="Подписи" desc="Шаблоны текста, которые вставляются в пост одним кликом (CTA, хэштеги, контакты)">
        <div className="space-y-2">
          {sigs.map((x) => (
            <div key={x.id} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{x.name}</div>
                <div className="mt-0.5 whitespace-pre-line text-sm text-zinc-500">{x.content}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  await api.del(`/api/signatures/${x.id}`);
                  loadSigs();
                }}
              />
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
            <Input placeholder="Название" value={sig.name} onChange={(e) => setSig({ ...sig, name: e.target.value })} />
            <Textarea rows={1} placeholder="Текст подписи" value={sig.content} onChange={(e) => setSig({ ...sig, content: e.target.value })} />
            <Button
              icon={<Plus className="size-4" />}
              disabled={!sig.name || !sig.content}
              onClick={async () => {
                await api.post('/api/signatures', sig);
                setSig({ name: '', content: '' });
                loadSigs();
              }}
            >
              Добавить
            </Button>
          </div>
        </div>
      </Section>

      <Section icon={<Bot className="size-4" />} title="MCP для Claude" desc="Через MCP Claude может готовить посты, загружать медиа, ставить в расписание и смотреть статистику">
        <div className="space-y-4 text-sm">
          <div className="space-y-3 rounded-lg border border-brand-500/30 bg-brand-50/50 p-4 dark:bg-brand-700/10">
            <div className="font-medium">Claude.ai и Claude Desktop (OAuth)</div>
            <ol className="list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
              <li>
                claude.ai → Settings → <b>Connectors</b> → <b>Add custom connector</b>
              </li>
              <li>Name: Social Panel, URL — ниже</li>
              <li>Connect → откроется окно панели → введите пароль → «Разрешить»</li>
            </ol>
            {https ? <CopyField label="Remote MCP server URL" value={`${s.public_base_url}/mcp`} /> : <div className="text-amber-600">Нужен публичный HTTPS-адрес (раздел выше)</div>}
            <p className="text-xs text-zinc-500">Коннектор синхронизируется между вебом, десктопом и мобильным приложением Claude.</p>
            {clients.length > 0 && (
              <div>
                <Label>Подключённые клиенты</Label>
                <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {clients.map((cl) => (
                    <div key={cl.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{cl.name ?? cl.id}</div>
                        <div className="truncate text-xs text-zinc-500">
                          {new URL(cl.redirect_uris[0]).host} · {cl.last_used_at ? `активен ${new Date(cl.last_used_at).toLocaleString('ru-RU')}` : 'ещё не использовался'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600"
                        onClick={async () => {
                          if (!confirm(`Отозвать доступ «${cl.name}»?`)) return;
                          await api.del(`/api/mcp-clients/${cl.id}`);
                          loadClients();
                        }}
                      >
                        Отозвать
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {https && mcp && (
            <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="font-medium">Claude Code по токену (без OAuth)</div>
              <CopyField label="Claude Code" value={`claude mcp add --transport http social-panel ${s.public_base_url}/mcp --header "Authorization: Bearer ${mcp.token}" --scope user`} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                Токен даёт полный доступ к публикациям — не публикуйте его.
                {!mcp.from_env && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm('Старый токен перестанет работать. Продолжить?')) return;
                      setMcp(await api.post('/api/mcp-token/rotate'));
                      toast('ok', 'Новый токен создан');
                    }}
                  >
                    Перевыпустить токен
                  </Button>
                )}
              </div>
            </div>
          )}
          <CopyField label="Локально, Claude Code (терминал)" value={mcpCmd} />
          <div>
            <Label>Claude Desktop → Settings → Developer → Edit config</Label>
            <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">{desktopJson}</pre>
          </div>
          <p className="text-zinc-500">
            Также в корне проекта лежит <code>.mcp.json</code> — Claude Code подхватит сервер автоматически, если открыть сессию в папке проекта. Публикация по расписанию выполняется сервером панели — держите его запущенным.
          </p>
        </div>
      </Section>
    </div>
  );
}
