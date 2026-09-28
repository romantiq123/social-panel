export class GraphError extends Error {
  code?: number;
  subcode?: number;
  /** Токен протух / отозван — канал нужно переподключить */
  get isAuth() {
    return this.code === 190 || this.code === 102;
  }
  /** Ошибка данных (не имеет смысла повторять) */
  get isPermanent() {
    return this.isAuth || this.code === 100 || this.code === 10 || this.code === 200 || this.code === 9004 || this.code === 36003;
  }
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

function toSearch(params: Params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  return sp;
}

export async function graph<T = any>(method: 'GET' | 'POST' | 'DELETE', url: string, params: Params = {}): Promise<T> {
  const sp = toSearch(params);
  const init: RequestInit = { method };
  let full = url;
  if (method === 'POST') {
    init.body = sp;
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  } else if ([...sp].length) {
    full += (url.includes('?') ? '&' : '?') + sp.toString();
  }
  const res = await fetch(full, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new GraphError(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    const msg = e.error_user_msg || e.message || json.error_message || `HTTP ${res.status}`;
    throw new GraphError(msg, e.code ?? json.code, e.error_subcode);
  }
  return json as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
