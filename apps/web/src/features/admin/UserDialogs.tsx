import { type AdminUser, type OrgUnit } from '@plataforma/contracts';
import { Copy, ImageOff, KeyRound, ShieldOff, Trash2, UserX } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Alert, Avatar, Button, Dialog, Select, Spinner, TextField, toast } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMe } from '../auth/auth-api';
import { useAdminUser, useRoles, useUserMutations } from './admin-api';
import { copyText } from './copy';
import { OrgUnitSelect } from './OrgUnitSelect';
import { RoleBadges, StatusLabel } from './UsersPage';

const fieldErrors = (e: unknown) =>
  e instanceof ApiRequestError
    ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, v[0]]))
    : {};
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);

interface Form {
  username: string;
  displayName: string;
  email: string;
  jobTitle: string;
  orgUnitId: string;
  kind: 'member' | 'guest';
  accessExpiresAt: string;
}
const empty: Form = {
  username: '',
  displayName: '',
  email: '',
  jobTitle: '',
  orgUnitId: '',
  kind: 'member',
  accessExpiresAt: '',
};

function UserFields({
  form,
  set,
  errors,
  units,
  isNew,
}: {
  form: Form;
  set: (f: Partial<Form>) => void;
  errors: Record<string, string | undefined>;
  units: OrgUnit[];
  isNew: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="Nome completo"
        value={form.displayName}
        onChange={(e) => set({ displayName: e.target.value })}
        error={errors.displayName}
        className="sm:col-span-2"
      />
      {isNew && (
        <TextField
          label="Usuário"
          value={form.username}
          onChange={(e) => set({ username: e.target.value.toLowerCase() })}
          error={errors.username}
          hint="Usado para entrar. Ex.: maria.silva"
          autoCapitalize="none"
          spellCheck={false}
        />
      )}
      <TextField
        label="E-mail"
        type="email"
        value={form.email}
        onChange={(e) => set({ email: e.target.value })}
        error={errors.email}
        hint="Opcional"
      />
      <TextField
        label="Cargo ou função"
        value={form.jobTitle}
        onChange={(e) => set({ jobTitle: e.target.value })}
        error={errors.jobTitle}
        hint="Opcional"
      />
      <OrgUnitSelect
        label="Lotação"
        emptyLabel="Sem lotação"
        units={units}
        value={form.orgUnitId}
        onChange={(v) => set({ orgUnitId: v })}
        error={errors.orgUnitId}
      />
      <Select
        label="Tipo de conta"
        value={form.kind}
        onChange={(e) => set({ kind: e.target.value as Form['kind'] })}
      >
        <option value="member">Servidor ou colaborador</option>
        <option value="guest">Convidado externo</option>
      </Select>
      {form.kind === 'guest' && (
        <TextField
          label="Acesso até"
          type="date"
          value={form.accessExpiresAt}
          onChange={(e) => set({ accessExpiresAt: e.target.value })}
          error={errors.accessExpiresAt}
          hint="Convidados só participam das conversas em que forem incluídos."
        />
      )}
    </div>
  );
}

function toBody(f: Form) {
  return {
    displayName: f.displayName,
    email: f.email || null,
    jobTitle: f.jobTitle || null,
    orgUnitId: f.orgUnitId || null,
    kind: f.kind,
    accessExpiresAt: f.kind === 'guest' ? endOfDay(f.accessExpiresAt) : null,
  };
}

function TemporaryPassword({ password, name }: { password: string; name: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-accent bg-accent-soft p-4">
      <p className="text-sm font-semibold">Senha temporária de {name}</p>
      <p className="mt-1 text-xs text-muted">
        Entregue à pessoa por um canal seguro. Ela será trocada no primeiro acesso e não aparece de
        novo.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded bg-surface px-3 py-2 text-lg font-bold tracking-wider">
          {password}
        </code>
        <Button
          variant="secondary"
          onClick={() =>
            void copyText(password).then((ok) =>
              toast(ok ? 'Senha copiada.' : 'Não foi possível copiar.', ok ? 'success' : 'error'),
            )
          }
        >
          <Copy size={15} aria-hidden="true" /> Copiar
        </Button>
      </div>
    </div>
  );
}

export function CreateUserDialog({
  open,
  onClose,
  units,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  units: OrgUnit[];
  onCreated: (id: string) => void;
}) {
  const { create } = useUserMutations();
  const [form, setForm] = useState<Form>(empty);
  const [result, setResult] = useState<{ id: string; name: string; password: string } | null>(null);
  const close = () => {
    setForm(empty);
    setResult(null);
    create.reset();
    onClose();
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { ...toBody(form), username: form.username },
      {
        onSuccess: (r) =>
          setResult({ id: r.user.id, name: r.user.displayName, password: r.temporaryPassword }),
      },
    );
  }
  const errors = fieldErrors(create.error);
  const general = create.error && !Object.keys(errors).length ? create.error.message : null;

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={result ? 'Usuário criado' : 'Novo usuário'}
      footer={
        result ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                const id = result.id;
                close();
                onCreated(id);
              }}
            >
              Ver usuário
            </Button>
            <Button onClick={close}>Concluir</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" form="create-user" loading={create.isPending}>
              Criar usuário
            </Button>
          </>
        )
      }
    >
      {result ? (
        <TemporaryPassword password={result.password} name={result.name} />
      ) : (
        <form id="create-user" onSubmit={submit} className="flex flex-col gap-4">
          {general && <Alert tone="error">{general}</Alert>}
          <UserFields
            form={form}
            set={(f) => setForm((x) => ({ ...x, ...f }))}
            errors={errors}
            units={units}
            isNew
          />
        </form>
      )}
    </Dialog>
  );
}

export function UserDetailDialog({
  id,
  onClose,
  units,
}: {
  id: string | null;
  onClose: () => void;
  units: OrgUnit[];
}) {
  const user = useAdminUser(id);
  const u = user.data;
  return (
    <Dialog
      open={!!id}
      onClose={onClose}
      size="lg"
      title={u?.displayName ?? 'Usuário'}
      description={u ? `${u.username}${u.kind === 'guest' ? ', convidado' : ''}` : undefined}
    >
      {!u ? (
        <div className="flex justify-center py-8">
          {user.isError ? (
            <Alert tone="error">{user.error.message}</Alert>
          ) : (
            <Spinner label="Carregando" />
          )}
        </div>
      ) : (
        <UserDetail key={u.id} u={u} units={units} onDeleted={onClose} />
      )}
    </Dialog>
  );
}

function UserDetail({
  u,
  units,
  onDeleted,
}: {
  u: AdminUser;
  units: OrgUnit[];
  onDeleted: () => void;
}) {
  const me = useMe().data!;
  const m = useUserMutations();
  const [form, setForm] = useState<Form>(() => ({
    username: u.username,
    displayName: u.displayName,
    email: u.email ?? '',
    jobTitle: u.jobTitle ?? '',
    orgUnitId: u.orgUnit?.id ?? '',
    kind: u.kind,
    accessExpiresAt: dateInput(u.accessExpiresAt),
  }));
  const [temp, setTemp] = useState<string | null>(null);
  const roleList = useRoles().data ?? [];
  const [newRole, setNewRole] = useState('unit_admin');
  const chosen = roleList.find((r) => r.key === newRole);
  const [roleUnit, setRoleUnit] = useState('');
  const canManage = me.permissions.includes('users.manage');
  const canAssign = me.permissions.includes('roles.assign');
  const canDelete = me.permissions.includes('users.delete') && u.id !== me.user.id;
  const fail = (e: Error) => toast(e.message, 'error');
  const errors = fieldErrors(m.update.error);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Avatar name={u.displayName} size={40} src={u.avatarUrl} />
        <span>
          Situação: <StatusLabel user={u} />
        </span>
        <span className="text-muted">
          Último acesso: {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'nunca'}
        </span>
        <span className="text-muted">Duas etapas: {u.mfaEnabled ? 'ativa' : 'inativa'}</span>
      </div>

      {temp && <TemporaryPassword password={temp} name={u.displayName} />}

      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.update.mutate(
              { id: u.id, body: toBody(form) },
              { onSuccess: () => toast('Dados salvos.') },
            );
          }}
          className="flex flex-col gap-4"
        >
          <UserFields
            form={form}
            set={(f) => setForm((x) => ({ ...x, ...f }))}
            errors={errors}
            units={units}
            isNew={false}
          />
          <div>
            <Button type="submit" loading={m.update.isPending}>
              Salvar dados
            </Button>
          </div>
        </form>
      )}

      {canManage && u.id !== me.user.id && (
        <section className="flex flex-wrap gap-2 border-t border-line pt-4">
          {u.status === 'active' ? (
            <Button
              variant="danger"
              loading={m.status.isPending}
              onClick={() =>
                m.status.mutate(
                  { id: u.id, status: 'blocked' },
                  {
                    onSuccess: () => toast('Usuário bloqueado e desconectado.'),
                    onError: fail,
                  },
                )
              }
            >
              Bloquear acesso
            </Button>
          ) : (
            <Button
              variant="secondary"
              loading={m.status.isPending}
              onClick={() =>
                m.status.mutate(
                  { id: u.id, status: 'active' },
                  { onSuccess: () => toast('Acesso liberado.'), onError: fail },
                )
              }
            >
              Liberar acesso
            </Button>
          )}
          {u.status === 'active' && u.lockedUntil && (
            <Button
              variant="secondary"
              onClick={() =>
                m.status.mutate(
                  { id: u.id, status: 'active' },
                  { onSuccess: () => toast('Bloqueio temporário removido.'), onError: fail },
                )
              }
            >
              Remover bloqueio temporário
            </Button>
          )}
          {u.authSource === 'local' && (
            <Button
              variant="secondary"
              loading={m.resetPassword.isPending}
              onClick={() =>
                m.resetPassword.mutate(u.id, {
                  onSuccess: (r) => setTemp(r.temporaryPassword),
                  onError: fail,
                })
              }
            >
              <KeyRound size={15} aria-hidden="true" /> Gerar senha temporária
            </Button>
          )}
          {canAssign && u.mfaEnabled && (
            <Button
              variant="secondary"
              loading={m.resetMfa.isPending}
              onClick={() =>
                m.resetMfa.mutate(u.id, {
                  onSuccess: () => toast('Verificação em duas etapas redefinida.'),
                  onError: fail,
                })
              }
            >
              <ShieldOff size={15} aria-hidden="true" /> Redefinir duas etapas
            </Button>
          )}
          {u.avatarUrl && (
            <Button
              variant="secondary"
              loading={m.removeAvatar.isPending}
              onClick={() =>
                m.removeAvatar.mutate(u.id, {
                  onSuccess: () => toast('Foto removida.'),
                  onError: fail,
                })
              }
            >
              <ImageOff size={15} aria-hidden="true" /> Remover foto
            </Button>
          )}
          {u.status !== 'disabled' && (
            <Button
              variant="ghost"
              onClick={() =>
                m.status.mutate(
                  { id: u.id, status: 'disabled' },
                  { onSuccess: () => toast('Conta marcada como desligada.'), onError: fail },
                )
              }
            >
              Marcar como desligado
            </Button>
          )}
        </section>
      )}

      <section className="border-t border-line pt-4">
        <h3 className="text-sm font-bold">Papéis</h3>
        <div className="mt-2">
          <RoleBadges user={u} />
        </div>
        {canAssign && (
          <>
            {u.roles.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-[var(--radius-control)] border border-line">
                {u.roles.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1">
                      <span className="font-semibold">{r.roleName}</span>
                      {r.orgUnit && (
                        <span className="text-muted"> em {r.orgUnit.name} e unidades abaixo</span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        m.removeRole.mutate({ id: u.id, assignmentId: r.id }, { onError: fail })
                      }
                      aria-label={`Remover papel ${r.roleName}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Select
                  label="Novo papel"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                >
                  {roleList.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              {chosen?.scoped && (
                <div className="w-64">
                  <OrgUnitSelect
                    label="Na unidade"
                    emptyLabel="Escolha"
                    units={units}
                    value={roleUnit}
                    onChange={setRoleUnit}
                  />
                </div>
              )}
              <Button
                variant="secondary"
                loading={m.assignRole.isPending}
                onClick={() =>
                  m.assignRole.mutate(
                    { id: u.id, body: { role: newRole, orgUnitId: roleUnit || null } },
                    { onSuccess: () => toast('Papel atribuído.'), onError: fail },
                  )
                }
              >
                Atribuir
              </Button>
            </div>
            {chosen?.description && (
              <p className="mt-2 text-xs text-muted">{chosen.description}.</p>
            )}
          </>
        )}
      </section>

      {canDelete && <DeleteUser u={u} onDeleted={onDeleted} />}
    </div>
  );
}

/**
 * Exclusão definitiva do diretório. Pede o login redigitado: é a única ação do painel
 * que não tem volta.
 */
function DeleteUser({ u, onDeleted }: { u: AdminUser; onDeleted: () => void }) {
  const m = useUserMutations();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const matches = confirm.trim().toLowerCase() === u.username;

  return (
    <section className="rounded-[var(--radius-panel)] border border-danger/40 bg-danger-soft/50 p-4">
      <h3 className="text-sm font-bold text-danger">Excluir usuário</h3>
      <p className="mt-1 text-sm text-muted">
        A pessoa sai do diretório e do organograma, perde o acesso e o login fica livre para outra
        pessoa. E-mail, senha, foto e papéis são apagados. As mensagens que ela já enviou continuam
        nas conversas, com o nome dela. Não é possível desfazer.
      </p>
      {!open ? (
        <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>
          <UserX size={15} aria-hidden="true" /> Excluir usuário
        </Button>
      ) : (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!matches) return;
            m.remove.mutate(
              { id: u.id, confirmUsername: confirm },
              {
                onSuccess: () => {
                  toast(`${u.displayName} foi excluído(a).`);
                  onDeleted();
                },
                onError: (err) => toast(err.message, 'error'),
              },
            );
          }}
        >
          <TextField
            label={`Para confirmar, digite o login: ${u.username}`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={!matches} loading={m.remove.isPending}>
              Excluir definitivamente
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setConfirm('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
