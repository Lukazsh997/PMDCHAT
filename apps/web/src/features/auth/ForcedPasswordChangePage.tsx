import { Button } from '@/components/ui';
import { ORG_NAME } from '@/lib/config';
import { useLogout } from './auth-api';
import { ChangePasswordForm } from './ChangePasswordForm';

/** Exibida no primeiro acesso ou após a senha ser redefinida pelo administrador. */
export function ForcedPasswordChangePage({ displayName }: { displayName: string }) {
  const logout = useLogout();
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="text-sm text-muted">{ORG_NAME}</p>
        <h1 className="mt-1 text-xl font-bold">Crie uma senha nova</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          {displayName}, a senha atual é provisória. Defina uma senha pessoal para continuar.
        </p>
        <ChangePasswordForm />
        <Button variant="ghost" className="mt-4 -ml-4" onClick={() => logout.mutate()}>
          Sair
        </Button>
      </div>
    </main>
  );
}
