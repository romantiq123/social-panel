import { useEffect, useState } from 'react';
import { CalendarDays, ListChecks, Image, Radio, BarChart3, ScrollText, Settings as SettingsIcon, Plus, LogOut, Moon, Sun, Menu, X } from 'lucide-react';
import { api, setUnauthorizedHandler } from './api';
import { StoreProvider, useRoute, useStore } from './store';
import { Button, cx, Spinner, ToastProvider, ChannelAvatar } from './components/ui';
import Composer from './components/Composer';
import Login from './pages/Login';
import CalendarPage from './pages/Calendar';
import PostsPage from './pages/Posts';
import MediaPage from './pages/Media';
import ChannelsPage from './pages/Channels';
import AnalyticsPage from './pages/Analytics';
import LogsPage from './pages/Logs';
import SettingsPage from './pages/Settings';

const NAV = [
  { path: '/calendar', label: 'Календарь', icon: CalendarDays },
  { path: '/posts', label: 'Посты', icon: ListChecks },
  { path: '/media', label: 'Медиа', icon: Image },
  { path: '/channels', label: 'Каналы', icon: Radio },
  { path: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { path: '/logs', label: 'Журнал', icon: ScrollText },
  { path: '/settings', label: 'Настройки', icon: SettingsIcon },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const s = localStorage.getItem('theme');
      return s ? s === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {}
  }, [dark]);
  return [dark, () => setDark((d) => !d)] as const;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { path } = useRoute();
  const { openComposer, composer, channels } = useStore();
  const [dark, toggleDark] = useTheme();
  const [menu, setMenu] = useState(false);

  useEffect(() => setMenu(false), [path]);

  const page = (() => {
    switch (path) {
      case '/posts':
        return <PostsPage />;
      case '/media':
        return <MediaPage />;
      case '/channels':
        return <ChannelsPage />;
      case '/analytics':
        return <AnalyticsPage />;
      case '/logs':
        return <LogsPage />;
      case '/settings':
        return <SettingsPage />;
      default:
        return <CalendarPage />;
    }
  })();

  const problems = channels.filter((c) => c.status !== 'active' || (c.token_days_left ?? 99) < 5);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center gap-2.5 px-2 pt-1">
        <div className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">SP</div>
        <div className="font-semibold tracking-tight">Social Panel</div>
      </div>
      <Button variant="primary" className="mb-3 w-full" icon={<Plus className="size-4" />} onClick={() => openComposer()}>
        Создать пост
      </Button>
      {NAV.map(({ path: p, label, icon: Icon }) => (
        <a
          key={p}
          href={`#${p}`}
          className={cx(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition',
            path === p ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
          )}
        >
          <Icon className="size-4" />
          {label}
          {p === '/channels' && problems.length > 0 && <span className="ml-auto size-2 rounded-full bg-red-500" />}
        </a>
      ))}
      <div className="mt-auto space-y-3">
        {channels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2">
            {channels.map((c) => (
              <div key={c.id} title={`${c.provider}: @${c.username}`} className={cx(c.status !== 'active' && 'opacity-40 grayscale')}>
                <ChannelAvatar provider={c.provider} avatar={c.avatar_url} username={c.username} size={28} />
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <Button variant="ghost" size="sm" onClick={toggleDark} icon={dark ? <Sun className="size-4" /> : <Moon className="size-4" />}>
            {dark ? 'Светлая' : 'Тёмная'}
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onLogout} icon={<LogOut className="size-4" />}>
            Выйти
          </Button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white lg:block dark:border-zinc-800 dark:bg-zinc-900">{sidebar}</aside>
      {menu && (
        <div className="fixed inset-0 z-40 bg-zinc-950/40 lg:hidden" onClick={() => setMenu(false)}>
          <aside className="h-full w-64 bg-white dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-200 bg-white/80 px-4 py-2.5 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/80">
          <button onClick={() => setMenu(true)} className="rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {menu ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="font-semibold">Social Panel</div>
          <Button variant="primary" size="sm" className="ml-auto" icon={<Plus className="size-4" />} onClick={() => openComposer()}>
            Пост
          </Button>
        </div>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{page}</div>
      </main>
      {composer && <Composer />}
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('out'));
    api
      .get('/api/me')
      .then(() => setAuth('in'))
      .catch(() => setAuth('out'));
  }, []);

  if (auth === 'loading')
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <ToastProvider>
      {auth === 'out' ? (
        <Login onDone={() => setAuth('in')} />
      ) : (
        <StoreProvider>
          <Shell
            onLogout={async () => {
              await api.post('/api/logout');
              setAuth('out');
            }}
          />
        </StoreProvider>
      )}
    </ToastProvider>
  );
}
