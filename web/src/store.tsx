import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Channel, type MediaRef, type Post } from './api';

export interface ComposerRequest {
  post?: Post;
  date?: Date;
  channelIds?: string[];
  media?: (MediaRef & { url: string })[];
}

interface Store {
  channels: Channel[];
  reloadChannels: () => Promise<void>;
  openComposer: (r?: ComposerRequest) => void;
  composer: ComposerRequest | null;
  closeComposer: () => void;
  /** Увеличивается после любых изменений постов — страницы перезагружают данные */
  version: number;
  bump: () => void;
}

const Ctx = createContext<Store>(null!);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [composer, setComposer] = useState<ComposerRequest | null>(null);
  const [version, setVersion] = useState(0);

  const reloadChannels = useCallback(async () => setChannels(await api.get<Channel[]>('/api/channels')), []);
  useEffect(() => {
    reloadChannels().catch(() => {});
  }, [reloadChannels]);

  return (
    <Ctx.Provider
      value={{
        channels,
        reloadChannels,
        composer,
        openComposer: (r = {}) => setComposer(r),
        closeComposer: () => setComposer(null),
        version,
        bump: () => setVersion((v) => v + 1),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** Простой hash-роутер: #/calendar?x=1 */
export function useRoute() {
  const parse = () => {
    const [path, qs] = window.location.hash.replace(/^#/, '').split('?');
    return { path: path || '/calendar', query: new URLSearchParams(qs ?? '') };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const h = () => setRoute(parse());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return route;
}

export const navigate = (to: string) => (window.location.hash = to);
