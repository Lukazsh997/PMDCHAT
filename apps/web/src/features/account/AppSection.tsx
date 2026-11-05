import { BellRing, Download, MonitorSmartphone } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { notifyStore, requestNotifications } from '@/lib/notifications';
import {
  ensurePushSubscription,
  installedStore,
  installStore,
  promptInstall,
  pushStore,
} from '@/lib/push';

/** Avisos com a aba fechada (Web Push) e instalação como aplicativo (PWA). */
export function AppSection() {
  const notify = notifyStore.use((s) => s);
  const push = pushStore.use((s) => s);
  const canInstall = installStore.use((s) => !!s);
  const installed = installedStore.use((s) => s);

  const pushText =
    notify === 'blocked-insecure' || push === 'unavailable'
      ? 'Indisponível neste endereço. A TI precisa incluir o sistema na política do Chrome (OverrideSecurityRestrictionsOnInsecureOrigin).'
      : notify === 'denied'
        ? 'Bloqueado neste navegador. Libere as notificações no ícone ao lado do endereço.'
        : push === 'on'
          ? 'Ativo: você recebe avisos mesmo com a aba do sistema fechada (com o Chrome aberto).'
          : push === 'error'
            ? 'Não foi possível ativar agora. Verifique a conexão com a internet e tente de novo.'
            : 'Desligado: você só recebe avisos com a aba do sistema aberta.';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <BellRing size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Avisos com a aba fechada</p>
          <p className="text-sm text-muted">{pushText}</p>
        </div>
        {push !== 'on' &&
          push !== 'unavailable' &&
          notify !== 'denied' &&
          notify !== 'blocked-insecure' && (
            <Button
              variant="secondary"
              onClick={async () => {
                const state =
                  notify === 'granted'
                    ? await ensurePushSubscription()
                    : (await requestNotifications(), await ensurePushSubscription());
                if (state === 'on') toast('Avisos ativados.');
              }}
            >
              Ativar
            </Button>
          )}
      </div>
      <div className="flex items-start gap-3">
        <MonitorSmartphone size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Aplicativo</p>
          <p className="text-sm text-muted">
            {installed
              ? 'Você está usando o sistema instalado como aplicativo.'
              : canInstall
                ? 'Instale para abrir o sistema numa janela própria, com ícone na barra de tarefas.'
                : 'Pelo Chrome: menu ⋮ › Transmitir, salvar e compartilhar › Instalar página como app. Em endereço sem HTTPS, depende da mesma política do Chrome dos avisos.'}
          </p>
        </div>
        {canInstall && !installed && (
          <Button variant="secondary" onClick={() => void promptInstall()}>
            <Download size={15} aria-hidden="true" /> Instalar
          </Button>
        )}
      </div>
    </div>
  );
}
