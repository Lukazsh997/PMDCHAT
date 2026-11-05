import type { AdminUser, UserStatus } from '@plataforma/contracts';
import { Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Avatar, Button, Select, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useMe } from '../auth/auth-api';
import { useOrgUnits, useUsers } from './admin-api';
import { OrgUnitSelect } from './OrgUnitSelect';
import { CreateUserDialog, UserDetailDialog } from './UserDialogs';

export const STATUS_LABEL: Record<UserStatus, string> = {
  active: 'Ativo',
  blocked: 'Bloqueado',
  disabled: 'Desligado',
};

export function UsersPage() {
  const me = useMe().data!;
  const canManage = me.permissions.includes('users.manage');
  const [q, setQ] = useState('');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const deferred = useDeferredValue(q.trim());
  const users = useUsers({
    q: deferred || undefined,
    orgUnitId: orgUnitId || undefined,
    status: status || undefined,
    page,
  });
  const units = useOrgUnits().data ?? [];
  const total = users.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="px-6 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex h-10 min-w-56 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 focus-within:border-primary">
          <Search size={16} className="text-muted" aria-hidden="true" />
          <span className="sr-only">Buscar usuários</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Nome, usuário ou e-mail"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
          />
        </label>
        <div className="w-60">
          <OrgUnitSelect
            label="Unidade"
            emptyLabel="Todas"
            units={units}
            value={orgUnitId}
            onChange={(v) => {
              setOrgUnitId(v);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40">
          <Select
            label="Situação"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as UserStatus | '');
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)} className="h-10">
            <Plus size={16} aria-hidden="true" /> Novo usuário
          </Button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Pessoa</th>
              <th className="px-4 py-2.5 font-semibold">Lotação</th>
              <th className="px-4 py-2.5 font-semibold">Papéis</th>
              <th className="px-4 py-2.5 font-semibold">Situação</th>
              <th className="px-4 py-2.5 font-semibold">Último acesso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.data?.items.map((u) => (
              <tr
                key={u.id}
                className="cursor-pointer hover:bg-line/30"
                onClick={() => setOpenId(u.id)}
              >
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    className="flex items-center gap-3 text-left"
                    onClick={() => setOpenId(u.id)}
                  >
                    <Avatar name={u.displayName} size={32} src={u.avatarUrl} />
                    <span>
                      <span className="block font-semibold">{u.displayName}</span>
                      <span className="block text-xs text-muted">
                        {u.username}
                        {u.kind === 'guest' && ', convidado'}
                        {u.authSource === 'ldap' && (
                          <span
                            title="Conta do Active Directory: entra com a senha da rede"
                            className="ml-1.5 rounded bg-line/60 px-1 py-px text-[10px] font-semibold text-muted"
                          >
                            AD
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {u.orgUnit?.acronym ?? u.orgUnit?.name ?? 'Sem lotação'}
                </td>
                <td className="px-4 py-2.5">
                  <RoleBadges user={u} />
                </td>
                <td className="px-4 py-2.5">
                  <StatusLabel user={u} />
                </td>
                <td className="px-4 py-2.5 text-muted tabular-nums">
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Nunca'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isPending && (
          <div className="flex justify-center py-8">
            <Spinner label="Carregando usuários" />
          </div>
        )}
        {users.data && users.data.items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            Nenhum usuário encontrado com esses filtros.
          </p>
        )}
      </div>

      {total > 25 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-sm">
          <span className="text-muted">
            Página {page} de {pages} ({total} pessoas)
          </span>
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        units={units}
        onCreated={(id) => setOpenId(id)}
      />
      <UserDetailDialog id={openId} onClose={() => setOpenId(null)} units={units} />
    </div>
  );
}

export function RoleBadges({ user }: { user: AdminUser }) {
  if (!user.roles.length) return <span className="text-muted">Usuário</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {user.roles.map((r) => (
        <span
          key={r.id}
          className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold dark:bg-rail-ink/10"
        >
          {r.roleName}
          {r.orgUnit ? `: ${r.orgUnit.acronym ?? r.orgUnit.name}` : ''}
        </span>
      ))}
    </span>
  );
}

export function StatusLabel({ user }: { user: AdminUser }) {
  const expired = user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date();
  if (user.status === 'active' && expired)
    return <span className="font-semibold text-muted">Acesso expirado</span>;
  if (user.status === 'active' && user.lockedUntil)
    return <span className="font-semibold text-danger">Bloqueio temporário</span>;
  const tone = user.status === 'active' ? 'text-ok' : 'text-danger';
  return <span className={`font-semibold ${tone}`}>{STATUS_LABEL[user.status]}</span>;
}
