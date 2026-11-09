import {
  type Permission,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type RoleDefinition,
} from '@plataforma/contracts';
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Dialog, Spinner, TextField, toast } from '@/components/ui';
import { useMe } from '../auth/auth-api';
import { useRoleMutations, useRoles } from './admin-api';

/**
 * Papéis e permissões. Os de sistema vêm da instalação (podem ter as permissões
 * ajustadas); os demais são criados aqui. O super administrador não muda.
 */
export function RolesPage() {
  const me = useMe().data!;
  const roles = useRoles();
  const canManage = me.permissions.includes('roles.manage');
  const [editing, setEditing] = useState<RoleDefinition | 'new' | null>(null);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Papéis e permissões</h2>
          <p className="text-sm text-muted">
            Um papel junta permissões. Ao atribuir, escolhe-se onde ele vale: no sistema todo ou
            numa unidade e nas de baixo. Mudanças valem na hora para quem já tem o papel.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> Novo papel
          </Button>
        )}
      </div>

      {roles.isPending ? (
        <Spinner label="Carregando papéis" />
      ) : roles.isError ? (
        <Alert tone="error">{roles.error.message}</Alert>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {roles.data.map((r) => (
            <li
              key={r.key}
              className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4"
            >
              <div className="flex items-start gap-2">
                <ShieldCheck
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-primary"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {r.name}
                    {r.isSystem && (
                      <span className="ml-2 rounded bg-line/60 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                        sistema
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {r.scoped ? 'Vale numa unidade e nas de baixo' : 'Vale no sistema todo'} ·{' '}
                    {r.assignmentCount} {r.assignmentCount === 1 ? 'pessoa' : 'pessoas'}
                  </p>
                </div>
                {canManage &&
                  (r.locked ? (
                    <Lock size={16} className="text-muted" aria-label="Não pode ser alterado" />
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setEditing(r)}
                      aria-label={`Editar ${r.name}`}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </Button>
                  ))}
              </div>
              {r.description && <p className="mt-2 text-sm">{r.description}</p>}
              <ul className="mt-3 flex flex-wrap gap-1">
                {(r.locked
                  ? ['Todas as permissões']
                  : r.permissions.map((p) => PERMISSIONS[p])
                ).map((label) => (
                  <li
                    key={label}
                    className="rounded bg-primary-soft px-1.5 py-0.5 text-xs text-ink"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <RoleDialog
        key={editing === 'new' ? 'new' : (editing?.key ?? 'none')}
        role={editing}
        myPermissions={me.permissions}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function RoleDialog({
  role,
  myPermissions,
  onClose,
}: {
  role: RoleDefinition | 'new' | null;
  myPermissions: Permission[];
  onClose: () => void;
}) {
  const m = useRoleMutations();
  const existing = role && role !== 'new' ? role : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [scoped, setScoped] = useState(existing?.scoped ?? true);
  const [perms, setPerms] = useState<Set<Permission>>(new Set(existing?.permissions ?? []));
  const [error, setError] = useState<string>();
  const mutation = existing ? m.update : m.create;
  const scopeLocked = !!existing && existing.assignmentCount > 0;

  function toggle(p: Permission) {
    setPerms((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return setError('Informe o nome do papel');
    if (!perms.size) return setError('Marque ao menos uma permissão');
    const body = {
      name: name.trim(),
      description: description.trim(),
      scoped,
      permissions: [...perms],
    };
    const done = {
      onSuccess: () => {
        toast(existing ? 'Papel atualizado.' : 'Papel criado.');
        onClose();
      },
    };
    if (existing) m.update.mutate({ key: existing.key, body }, done);
    else m.create.mutate(body, done);
  }

  return (
    <Dialog
      open={!!role}
      onClose={onClose}
      size="lg"
      title={existing ? `Editar ${existing.name}` : 'Novo papel'}
      footer={
        <>
          {existing && !existing.isSystem && (
            <Button
              variant="danger"
              className="mr-auto"
              loading={m.remove.isPending}
              onClick={() =>
                m.remove.mutate(existing.key, {
                  onSuccess: () => {
                    toast('Papel excluído.');
                    onClose();
                  },
                  onError: (e) => toast(e.message, 'error'),
                })
              }
            >
              <Trash2 size={15} aria-hidden="true" /> Excluir
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="role-form" loading={mutation.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="role-form" onSubmit={submit} className="flex flex-col gap-4">
        {(error || mutation.error) && (
          <Alert tone="error">{error ?? mutation.error?.message}</Alert>
        )}
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <TextField
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={240}
        />
        <fieldset disabled={scopeLocked} className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-semibold">Onde vale</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={scoped}
              onChange={() => setScoped(true)}
              className="accent-[var(--color-primary)]"
            />
            Numa unidade e nas de baixo (escolhida ao atribuir)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!scoped}
              onChange={() => setScoped(false)}
              className="accent-[var(--color-primary)]"
            />
            No sistema todo
          </label>
          {scopeLocked && (
            <p className="text-xs text-muted">
              Já atribuído a pessoas: para mudar isto, remova as atribuições antes.
            </p>
          )}
        </fieldset>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Permissões</p>
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.label}>
              <legend className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">
                {g.label}
              </legend>
              <div className="flex flex-col gap-1">
                {g.permissions.map((p) => {
                  // Só se concede o que você mesmo tem.
                  const mine = myPermissions.includes(p);
                  return (
                    <label
                      key={p}
                      className={`flex items-center gap-2 text-sm ${mine ? '' : 'opacity-50'}`}
                      title={mine ? undefined : 'Você não tem esta permissão para concedê-la'}
                    >
                      <input
                        type="checkbox"
                        checked={perms.has(p)}
                        disabled={!mine}
                        onChange={() => toggle(p)}
                        className="accent-[var(--color-primary)]"
                      />
                      {PERMISSIONS[p]}
                      {p === 'admin.access' && (
                        <span className="text-xs text-muted">
                          (exige verificação em duas etapas)
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </form>
    </Dialog>
  );
}
