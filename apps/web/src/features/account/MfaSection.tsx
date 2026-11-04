import type { MfaSetupResponse } from '@plataforma/contracts';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, TextField, toast } from '@/components/ui';
import { useMe, useMfaDisable, useMfaEnable, useMfaSetup } from '../auth/auth-api';

/** Ativação da verificação em duas etapas com qualquer aplicativo autenticador. */
export function MfaSection() {
  const me = useMe().data!;
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const disable = useMfaDisable();
  const [data, setData] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const isAdmin = me.permissions.includes('admin.access');

  if (me.user.mfaEnabled) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ok">
          <ShieldCheck size={18} aria-hidden="true" /> Ativa. O código do aplicativo é pedido a cada
          login.
        </p>
        {isAdmin ? (
          <p className="text-sm text-muted">
            Quem administra o sistema precisa manter a verificação ativa.
          </p>
        ) : (
          <form
            className="flex max-w-sm flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              disable.mutate(password, {
                onSuccess: () => toast('Verificação em duas etapas desativada.'),
              });
            }}
          >
            <TextField
              label="Senha atual, para desativar"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={disable.error?.message}
            />
            <div>
              <Button
                variant="danger"
                type="submit"
                loading={disable.isPending}
                disabled={!password}
              >
                Desativar
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        {me.mfaSetupRequired && (
          <Alert tone="error">
            Como você administra o sistema, ative a verificação em duas etapas para usar o painel.
          </Alert>
        )}
        {setup.error && <Alert tone="error">{setup.error.message}</Alert>}
        <div>
          <Button
            loading={setup.isPending}
            onClick={() => setup.mutate(undefined, { onSuccess: setData })}
          >
            Ativar verificação em duas etapas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:flex-row">
      <img
        src={data.qrCodeDataUrl}
        alt="QR code para o aplicativo autenticador"
        width={180}
        height={180}
        className="shrink-0 self-start rounded-[var(--radius-control)] border border-line bg-white p-2"
      />
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
        <li>
          Instale um aplicativo autenticador no celular (Microsoft Authenticator, Google
          Authenticator, FreeOTP ou Aegis).
        </li>
        <li>
          No aplicativo, leia o QR code. Sem câmera, digite a chave:
          <code className="mt-1 block rounded bg-paper px-2 py-1 font-semibold tracking-wider break-all">
            {data.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
        </li>
        <li>
          Digite o código de 6 números que o aplicativo mostrar.
          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate(code, {
                onSuccess: () => {
                  setData(null);
                  toast('Verificação em duas etapas ativada.');
                },
              });
            }}
          >
            <TextField
              label="Código"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              error={enable.error?.message}
              className="w-40"
            />
            <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
              Confirmar
            </Button>
          </form>
        </li>
      </ol>
    </div>
  );
}
