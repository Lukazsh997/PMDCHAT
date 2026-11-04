import { useState } from 'react';
import { Button, Select, Spinner, TextField } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useAudit } from './admin-api';

/** Rótulos em português das ações registradas. */
const ACTIONS: Record<string, string> = {
  'auth.login_succeeded': 'Entrou no sistema',
  'auth.login_failed': 'Tentativa de login recusada',
  'auth.account_locked': 'Conta bloqueada por tentativas',
  'auth.logout': 'Saiu do sistema',
  'auth.password_changed': 'Trocou a senha',
  'auth.password_reset': 'Gerou senha temporária',
  'auth.mfa_enabled': 'Ativou duas etapas',
  'auth.mfa_disabled': 'Desativou duas etapas',
  'auth.mfa_failed': 'Código de duas etapas incorreto',
  'auth.mfa_reset': 'Redefiniu duas etapas',
  'user.created': 'Criou usuário',
  'user.updated': 'Alterou dados de usuário',
  'user.status_changed': 'Alterou situação de usuário',
  'role.assigned': 'Atribuiu papel',
  'role.removed': 'Removeu papel',
  'org_unit.created': 'Criou unidade',
  'org_unit.updated': 'Alterou unidade',
  'org_unit.deleted': 'Excluiu unidade',
  'conversation.created': 'Criou grupo',
  'conversation.updated': 'Alterou grupo',
  'conversation.members_added': 'Adicionou pessoas a grupo',
  'conversation.member_removed': 'Removeu pessoa de grupo',
  'message.deleted': 'Apagou a própria mensagem',
  'message.deleted_by_moderator': 'Apagou mensagem de outra pessoa',
  'file.rejected': 'Arquivo barrado pelo antivírus',
};

const GROUPS = [
  ['', 'Todas'],
  ['auth.', 'Acesso e senhas'],
  ['user.', 'Usuários'],
  ['role.', 'Papéis'],
  ['org_unit.', 'Organograma'],
  ['conversation.', 'Grupos'],
  ['message.', 'Mensagens apagadas'],
  ['file.', 'Arquivos barrados'],
] as const;

export function AuditPage() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const audit = useAudit({
    action: action || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    page,
  });
  const total = audit.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="px-6 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            label="Tipo de ação"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            {GROUPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <TextField
          label="De"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <TextField
          label="Até"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Quando</th>
              <th className="px-4 py-2.5 font-semibold">Quem</th>
              <th className="px-4 py-2.5 font-semibold">O quê</th>
              <th className="px-4 py-2.5 font-semibold">Detalhes</th>
              <th className="px-4 py-2.5 font-semibold">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {audit.data?.items.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2 whitespace-nowrap text-muted tabular-nums">
                  {formatDateTime(e.createdAt)}
                </td>
                <td className="px-4 py-2">
                  {e.actor ? e.actor.displayName : <span className="text-muted">Sistema</span>}
                </td>
                <td className="px-4 py-2">{ACTIONS[e.action] ?? e.action}</td>
                <td
                  className="max-w-md truncate px-4 py-2 text-xs text-muted"
                  title={e.metadata ? JSON.stringify(e.metadata) : ''}
                >
                  {describe(e.metadata)}
                </td>
                <td className="px-4 py-2 text-xs text-muted tabular-nums">{e.ip ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {audit.isPending && (
          <div className="flex justify-center py-8">
            <Spinner label="Carregando registros" />
          </div>
        )}
        {audit.data?.items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">Nenhum registro com esses filtros.</p>
        )}
      </div>
      {total > 50 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-sm">
          <span className="text-muted">
            Página {page} de {pages}
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
    </div>
  );
}

function describe(meta: Record<string, unknown> | null): string {
  if (!meta) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined || typeof v === 'object') continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(', ');
}
