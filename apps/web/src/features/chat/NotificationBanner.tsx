import { BellRing, X } from 'lucide-react';
import { useState } from 'react';
import { notifyStore, requestNotifications } from '@/lib/notifications';

const DISMISS_KEY = 'notificacoes-aviso-fechado';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Convida a ativar as notificações do Chrome, ou explica por que estão bloqueadas. */
export function NotificationBanner() {
  const state = notifyStore.use((s) => s);
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (dismissed || state === 'granted' || state === 'unsupported') return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* navegador sem armazenamento: o aviso volta na próxima vez */
    }
    setDismissed(true);
  };

  const text =
    state === 'blocked-insecure'
      ? 'O navegador bloqueia notificações neste endereço. Peça à TI para liberar o sistema na política do Chrome.'
      : state === 'denied'
        ? 'As notificações estão bloqueadas. Libere-as no ícone de cadeado da barra de endereço.'
        : 'Receba um aviso quando chegar mensagem, mesmo com a aba em segundo plano.';

  return (
    <div className="flex items-start gap-2.5 border-b border-line bg-ipe-soft px-4 py-2.5 text-sm">
      <BellRing size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>{text}</p>
        {state === 'default' && (
          <button
            type="button"
            onClick={() => void requestNotifications()}
            className="mt-1 font-semibold text-primary hover:underline"
          >
            Ativar notificações
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fechar aviso"
        className="rounded p-0.5 text-muted hover:text-ink"
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
