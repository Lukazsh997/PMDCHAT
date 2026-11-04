import { loginRequestSchema } from '@plataforma/contracts';
import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import { Alert, Button, TextField } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { ORG_NAME } from '@/lib/config';
import { useLogin, useMe } from './auth-api';

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  if (me.data) return <Navigate to="/" replace />;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = loginRequestSchema.safeParse({
      username: form.get('username'),
      password: form.get('password'),
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    login.mutate(parsed.data);
  }

  const apiError = login.error instanceof ApiRequestError ? login.error : null;
  const fields = { ...fieldErrors, ...flatten(apiError?.fields) };

  return (
    <main className="grid min-h-dvh md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-rail p-12 text-rail-ink md:flex">
        <LogoMark />
        <div className="max-w-md">
          <p className="text-2xl leading-tight font-bold">{ORG_NAME}</p>
          <p className="mt-3 text-base text-rail-ink/75">
            Conversas, grupos e avisos da organização, num só lugar e dentro da nossa rede.
          </p>
        </div>
        <div aria-hidden="true" className="absolute right-0 bottom-0 h-1.5 w-1/3 bg-ipe" />
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden">
            <LogoMark />
            <p className="mt-4 text-lg font-bold">{ORG_NAME}</p>
          </div>
          <h1 className="text-xl font-bold">Entrar</h1>
          <p className="mt-1 text-sm text-muted">
            Use o usuário e a senha fornecidos pela sua unidade.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
            {apiError && !apiError.fields.username && !apiError.fields.password && (
              <Alert tone="error">{apiError.message}</Alert>
            )}
            <TextField
              label="Usuário"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              error={fields.username}
            />
            <TextField
              label="Senha"
              name="password"
              type="password"
              autoComplete="current-password"
              error={fields.password}
            />
            <Button type="submit" block loading={login.isPending} className="mt-2 h-10">
              Entrar
            </Button>
          </form>
          <p className="mt-6 text-xs text-muted">
            Esqueceu a senha? Procure o administrador do sistema na sua unidade.
          </p>
        </div>
      </section>
    </main>
  );
}

function flatten(fields: Record<string, string[]> | undefined): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, v[0]]));
}

function LogoMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-rail-strong md:fill-rail-ink/10" />
      <path
        d="M9 11.5a3.5 3.5 0 0 1 3.5-3.5h7a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-3.5 3.5H15l-4.2 3.4c-.5.4-1.3 0-1.3-.6V19.6A3.5 3.5 0 0 1 9 16.5z"
        className="fill-rail-ink"
      />
      <circle cx="22.5" cy="9.5" r="3.5" className="fill-ipe" />
    </svg>
  );
}
