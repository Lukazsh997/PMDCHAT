import { changePasswordRequestSchema, PASSWORD_POLICY } from '@plataforma/contracts';
import { type FormEvent, useState } from 'react';
import { Alert, Button, TextField } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { useChangePassword } from './auth-api';

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const change = useChangePassword();
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saved, setSaved] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get('newPassword') ?? '');
    if (newPassword !== form.get('confirmPassword')) {
      setErrors({ confirmPassword: 'As senhas não conferem' });
      return;
    }
    const parsed = changePasswordRequestSchema.safeParse({
      currentPassword: form.get('currentPassword'),
      newPassword,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaved(false);
    change.mutate(parsed.data, {
      onSuccess: () => {
        formEl.reset();
        setSaved(true);
        onDone?.();
      },
      onError: (err) => {
        if (err instanceof ApiRequestError) {
          setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]])));
        }
      },
    });
  }

  const generalError =
    change.error instanceof ApiRequestError && !Object.keys(change.error.fields).length
      ? change.error.message
      : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {generalError && <Alert tone="error">{generalError}</Alert>}
      {saved && <Alert tone="success">Senha alterada. As outras sessões foram encerradas.</Alert>}
      <TextField
        label="Senha atual"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword}
      />
      <TextField
        label="Nova senha"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint={`Mínimo de ${PASSWORD_POLICY.minLength} caracteres.`}
        error={errors.newPassword}
      />
      <TextField
        label="Confirme a nova senha"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword}
      />
      <div>
        <Button type="submit" loading={change.isPending}>
          Alterar senha
        </Button>
      </div>
    </form>
  );
}
