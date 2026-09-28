import type { Provider, ProviderApi } from '../types.ts';
import { threads } from './threads.ts';
import { instagram } from './instagram.ts';

export const providers: Record<Provider, ProviderApi> = { threads, instagram };

export function getProvider(id: string): ProviderApi {
  const p = providers[id as Provider];
  if (!p) throw new Error(`Неизвестный провайдер: ${id}`);
  return p;
}
