import { Spinner } from '@/components/ui';
import { useStats } from './admin-api';

export function OverviewPage() {
  const stats = useStats();
  if (stats.isPending)
    return (
      <div className="p-6">
        <Spinner label="Carregando" />
      </div>
    );
  if (!stats.data) return null;
  const s = stats.data;
  const rows: [string, number, string?][] = [
    ['Pessoas conectadas agora', s.onlineNow],
    ['Usuários ativos', s.activeUsers, s.guests ? `${s.guests} convidados` : undefined],
    ['Usuários bloqueados', s.blockedUsers],
    ['Mensagens nas últimas 24 h', s.messagesLast24h],
    ['Conversas', s.conversations],
    ['Unidades no organograma', s.orgUnits],
  ];
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <dl className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
        {rows.map(([label, value, note]) => (
          <div key={label} className="flex items-baseline gap-4 px-5 py-3.5">
            <dt className="flex-1 text-sm text-muted">{label}</dt>
            <dd className="text-right">
              <span className="text-lg font-bold tabular-nums">
                {value.toLocaleString('pt-BR')}
              </span>
              {note && <span className="ml-2 text-xs text-muted">{note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
