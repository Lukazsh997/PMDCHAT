import { CircleAlert, CircleCheck } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

interface ToastItem {
  id: number;
  tone: 'error' | 'success';
  message: string;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Aviso rápido no canto da tela (ex.: "Senha temporária copiada"). */
export function toast(message: string, tone: ToastItem['tone'] = 'success') {
  const id = ++seq;
  items = [...items, { id, tone, message }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 5000);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
  useEffect(() => undefined, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
    >
      {list.map((t) => {
        const Icon = t.tone === 'error' ? CircleAlert : CircleCheck;
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm shadow-lg ${t.tone === 'error' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-line bg-surface text-ink'}`}
          >
            <Icon
              size={16}
              className={`mt-0.5 shrink-0 ${t.tone === 'success' ? 'text-ok' : ''}`}
              aria-hidden="true"
            />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
