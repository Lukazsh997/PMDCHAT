import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Alert, Button, Spinner } from '@/components/ui';
import { useMe } from './auth-api';
import { ForcedPasswordChangePage } from './ForcedPasswordChangePage';

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Carregando" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
        <Alert tone="error">{me.error.message}</Alert>
        <Button variant="secondary" onClick={() => void me.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (!me.data) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (me.data.user.mustChangePassword) {
    return <ForcedPasswordChangePage displayName={me.data.user.displayName} />;
  }
  return children;
}
