import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { PostStatus, Provider } from '../api';
import { STATUS_LABEL } from '../api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* --------------------------------- Button --------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
  ghost: 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* --------------------------------- Inputs --------------------------------- */

const field =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-900';

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, 'h-9', p.className)} />;
export const Textarea = (p: React.ComponentProps<'textarea'>) => <textarea {...p} className={cx(field, 'resize-y', p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, 'h-9 pr-8', p.className)} />;

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
      <span>{children}</span>
      {hint && <span className="font-normal text-zinc-400">{hint}</span>}
    </label>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
      {icon && <div className="mb-3 text-zinc-400">{icon}</div>}
      <div className="font-medium">{title}</div>
      {text && <div className="mt-1 max-w-md text-sm text-zinc-500">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------------------------------- Badge --------------------------------- */

const STATUS_STYLE: Record<PostStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  scheduled: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  publishing: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
};
export const STATUS_DOT: Record<PostStatus, string> = {
  draft: 'bg-zinc-400',
  scheduled: 'bg-blue-500',
  publishing: 'bg-amber-500',
  published: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[status])}>
      <span className={cx('size-1.5 rounded-full', STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Badge({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'green' | 'red' | 'amber' | 'brand' }) {
  const t = {
    zinc: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100',
  }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

/* --------------------------------- Provider -------------------------------- */

export function ProviderIcon({ provider, className = 'size-4' }: { provider: Provider; className?: string }) {
  if (provider === 'threads')
    return (
      <svg viewBox="0 0 192 192" className={className} fill="currentColor" aria-label="Threads">
        <path d="M141.5 88.9c-.8-.4-1.7-.8-2.5-1.2-1.5-27.1-16.3-42.6-41.1-42.8h-.3c-14.8 0-27.2 6.3-34.8 17.9l13.6 9.4c5.7-8.6 14.6-10.4 21.2-10.4h.2c8.2.1 14.4 2.4 18.4 7.1 2.9 3.4 4.8 8.1 5.8 14-7.3-1.2-15.2-1.6-23.6-1.2-23.8 1.4-39 15.2-38 34.4.5 9.7 5.4 18.1 13.7 23.6 7.1 4.7 16.1 6.9 25.5 6.4 12.4-.7 22.2-5.4 29-14.1 5.2-6.6 8.5-15.2 9.9-25.9 5.9 3.6 10.3 8.3 12.7 13.9 4.1 9.6 4.4 25.4-8.5 38.3-11.3 11.3-24.9 16.2-45.4 16.3-22.8-.2-40-7.5-51.2-21.7C45.3 140 39.9 120.7 39.7 96c.2-24.7 5.6-44 16.1-57.2 11.2-14.2 28.4-21.5 51.2-21.7 22.9.2 40.4 7.5 52 21.8 5.7 7 10 15.8 12.8 26.1l16-4.3c-3.4-12.7-8.8-23.6-16.3-32.8C156.3 9.6 134.8.4 107.1.2h-.1C79.3.4 58.1 9.6 44 27.4 31.4 43.3 25 65.4 24.8 96v.1c.2 30.6 6.7 52.7 19.2 68.6 14.1 17.8 35.3 27 63 27.2h.1c24.6-.2 42-6.6 56.3-20.9 18.7-18.7 18.2-42.2 12-56.6-4.4-10.3-12.9-18.7-24-24.3zm-42.4 39.9c-10.3.6-21.1-4-21.6-13.9-.4-7.3 5.2-15.5 22.1-16.5 1.9-.1 3.8-.2 5.7-.2 6.1 0 11.9.6 17.1 1.7-1.9 24.3-13.4 28.4-23.3 28.9z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-label="Instagram">
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export const PROVIDER_COLOR: Record<Provider, string> = {
  threads: 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900',
  instagram: 'bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600 text-white',
};

export function ChannelAvatar({ provider, avatar, username, size = 36 }: { provider: Provider; avatar?: string | null; username: string; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatar ? (
        <img src={avatar} alt={username} className="size-full rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex size-full items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
          {username[0]}
        </div>
      )}
      <span className={cx('absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full ring-2 ring-white dark:ring-zinc-900', PROVIDER_COLOR[provider])} style={{ width: size * 0.45, height: size * 0.45 }}>
        <ProviderIcon provider={provider} className="size-[70%]" />
      </span>
    </div>
  );
}

/* ---------------------------------- Modal --------------------------------- */

export function Modal({ open, onClose, title, children, width = 'max-w-lg', footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 backdrop-blur-sm sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('w-full rounded-2xl bg-white shadow-2xl dark:bg-zinc-900', width)}>
        {title && (
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
            <div className="font-semibold">{title}</div>
            <button onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
              <X className="size-5" />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------- Toasts --------------------------------- */

type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-white p-3.5 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
            <div className="whitespace-pre-line">{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-zinc-400', className)} />;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
      {items.map((i) => (
        <button
          key={i.value}
          onClick={() => onChange(i.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition',
            value === i.value ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
