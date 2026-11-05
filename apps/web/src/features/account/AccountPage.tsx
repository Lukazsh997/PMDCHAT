import type { ReactNode } from 'react';
import { Monitor } from 'lucide-react';
import { Alert, Button, Spinner } from '@/components/ui';
import { describeUserAgent, formatDateTime } from '@/lib/format';
import { useMe, useRevokeSession, useSessions } from '../auth/auth-api';
import { ChangePasswordForm } from '../auth/ChangePasswordForm';
import { AvatarEditor } from './AvatarEditor';
import { MfaSection } from './MfaSection';

export function AccountPage() {
  const me = useMe();
  const user = me.data?.user;
  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <header className="min-w-0">
        <h1 className="truncate text-xl font-bold">{user.displayName}</h1>
        <p className="text-sm text-muted">
          {[user.username, user.jobTitle, user.orgUnit?.name].filter(Boolean).join(', ')}
        </p>
      </header>

      <Section
        title="Foto de perfil"
        description="Aparece para as outras pessoas nas conversas e no organograma. JPG, PNG ou WebP de até 5 MB."
      >
        <AvatarEditor user={user} />
      </Section>

      {user.authSource === 'local' && (
        <Section
          title="Senha"
          description="Ao alterar a senha, os outros dispositivos são desconectados."
        >
          <div className="max-w-sm">
            <ChangePasswordForm />
          </div>
        </Section>
      )}

      {user.authSource === 'local' && (
        <Section
          title="Verificação em duas etapas"
          description="Além da senha, pede um código do seu celular ao entrar. Protege a conta mesmo se a senha vazar."
        >
          <MfaSection />
        </Section>
      )}

      <Section
        title="Dispositivos conectados"
        description="Encerre o acesso de um computador que você não usa mais ou não reconhece."
      >
        <SessionList />
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 mb-5 text-sm text-muted">{description}</p>
      {children}
    </section>
  );
}

function SessionList() {
  const sessions = useSessions();
  const revoke = useRevokeSession();

  if (sessions.isPending) return <Spinner label="Carregando dispositivos" />;
  if (sessions.isError) return <Alert tone="error">{sessions.error.message}</Alert>;

  return (
    <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
      {sessions.data.map((s) => (
        <li key={s.id} className="flex items-center gap-3 px-4 py-3">
          <Monitor size={18} className="shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {s.deviceType === 'desktop'
                ? 'Aplicativo para Windows'
                : describeUserAgent(s.userAgent)}
              {s.current && <span className="ml-2 font-normal text-ok">este dispositivo</span>}
            </p>
            <p className="text-xs text-muted">
              Último uso em {formatDateTime(s.lastUsedAt)}
              {s.ip ? `, IP ${s.ip}` : ''}
            </p>
          </div>
          {!s.current && (
            <Button
              variant="danger"
              loading={revoke.isPending && revoke.variables === s.id}
              onClick={() => revoke.mutate(s.id)}
            >
              Encerrar
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
