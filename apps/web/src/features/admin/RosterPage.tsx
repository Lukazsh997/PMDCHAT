import type {
  OrgUnit,
  RosterApplyResult,
  RosterPlan,
  RosterPlanRequest,
  RosterSetor,
} from '@plataforma/contracts';
import { AlertTriangle, CheckCircle2, FileUp, RotateCcw } from 'lucide-react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Dialog, Spinner, toast } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useOrgUnits } from './admin-api';
import { useRosterMutations, useRosterStatus } from './roster-api';

interface Decisions {
  secretarias: Record<string, string>;
  setores: Record<string, string>;
  parentId?: string | null;
  removal: 'delete' | 'disable';
}

const EMPTY: Decisions = { secretarias: {}, setores: {}, removal: 'delete' };

/**
 * Painel → Lotação: importar a lista de quem trabalha em cada setor (exportação de
 * outro sistema em .sql ou planilha .csv). Mostra a prévia, deixa acertar secretarias
 * e setores e só grava ao confirmar.
 */
export function RosterPage() {
  const status = useRosterStatus();
  const units = useOrgUnits();
  const { preview, apply, deactivate } = useRosterMutations();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [decisions, setDecisions] = useState<Decisions>(EMPTY);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RosterApplyResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const request = (f: { name: string; content: string }, d: Decisions): RosterPlanRequest => ({
    fileName: f.name,
    content: f.content,
    secretarias: d.secretarias,
    setores: d.setores,
    ...(d.parentId !== undefined ? { parentId: d.parentId } : {}),
    removal: d.removal,
  });

  const decide = (next: Decisions) => {
    setDecisions(next);
    if (file) preview.mutate(request(file, next));
  };

  const load = async (f: File) => {
    const content = await readText(f);
    const loaded = { name: f.name, content };
    setFile(loaded);
    setResult(null);
    setConfirmLarge(false);
    setDecisions(EMPTY);
    preview.mutate(request(loaded, EMPTY));
  };

  const plan = preview.data;
  const run = () => {
    if (!file) return;
    apply.mutate(
      { ...request(file, decisions), confirmLargeRemoval: confirmLarge },
      {
        onSuccess: (r) => {
          setConfirming(false);
          setResult(r);
          setFile(null);
          preview.reset();
          toast('Lista de lotação importada.');
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <div>
        <h2 className="text-lg font-bold">Lista de lotação</h2>
        <p className="text-sm text-muted">
          Importe a lista de quem trabalha em cada setor (exportação de outro sistema em .sql, ou
          planilha .csv com login, nome, secretaria e setor). O sistema monta as secretarias e os
          setores no organograma e lota as pessoas. Com o Active Directory, só tem conta quem está
          na lista: quem é do AD e ficou de fora sai do sistema.
        </p>
      </div>

      {status.data && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1 text-sm">
            {status.data.active ? (
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={16} className="text-primary" aria-hidden="true" />
                Em uso: {status.data.entries} pessoas na lista.
              </p>
            ) : (
              <p className="font-semibold">
                {status.data.lastImport
                  ? 'Desligada: a lotação vem das OUs do Active Directory.'
                  : 'Nenhuma lista importada ainda.'}
              </p>
            )}
            {status.data.lastImport && (
              <p className="text-xs text-muted">
                Última importação: {status.data.lastImport.fileName}, em{' '}
                {formatDateTime(status.data.lastImport.at)}
                {status.data.lastImport.actorName && ` por ${status.data.lastImport.actorName}`}.
              </p>
            )}
          </div>
          {status.data.active && (
            <Button
              variant="secondary"
              loading={deactivate.isPending}
              onClick={() =>
                deactivate.mutate(undefined, {
                  onSuccess: () => toast('A lotação voltou a vir das OUs do AD.'),
                })
              }
            >
              <RotateCcw size={15} aria-hidden="true" /> Voltar a usar as OUs do AD
            </Button>
          )}
        </div>
      )}

      {result && (
        <Alert tone="success">
          Importação concluída: {result.entries} pessoas na lista, {result.created} unidades
          criadas, {result.moved} pessoas mudaram de lotação e {result.removed}{' '}
          {result.removed === 1 ? 'conta saiu' : 'contas saíram'}. Quem está na lista e ainda não
          tem conta ganha a sua na próxima sincronização com o AD ou ao entrar pela primeira vez.
        </Alert>
      )}

      <div className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-5 py-6 text-center">
        <input
          ref={input}
          type="file"
          accept=".sql,.csv,.txt,text/csv,text/plain"
          className="sr-only"
          aria-label="Arquivo da lista de lotação"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = '';
          }}
        />
        <Button variant={file ? 'secondary' : 'primary'} onClick={() => input.current?.click()}>
          <FileUp size={16} aria-hidden="true" />{' '}
          {file ? 'Escolher outro arquivo' : 'Escolher arquivo'}
        </Button>
        <p className="mt-2 text-xs text-muted">
          {file
            ? file.name
            : '.sql (INSERTs ou COPY) ou .csv. Senhas e outros dados do arquivo são ignorados.'}
        </p>
      </div>

      {preview.isPending && <Spinner label="Lendo o arquivo" />}
      {preview.isError && <Alert tone="error">{preview.error.message}</Alert>}

      {plan && file && !preview.isPending && (
        <>
          <Summary plan={plan} />
          <SecretariasSection
            plan={plan}
            units={units.data ?? []}
            decisions={decisions}
            onChange={decide}
          />
          <SetoresSection plan={plan} decisions={decisions} onChange={decide} />
          <PeopleSection plan={plan} />
          <RemovalSection
            plan={plan}
            decisions={decisions}
            onChange={decide}
            confirmLarge={confirmLarge}
            setConfirmLarge={setConfirmLarge}
          />
          <div className="flex justify-end">
            <Button
              disabled={plan.removal.needsConfirmation && !confirmLarge}
              onClick={() => setConfirming(true)}
            >
              Importar lista
            </Button>
          </div>
        </>
      )}

      {confirming && plan && (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title="Importar a lista de lotação?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
              <Button
                variant={plan.removal.count ? 'danger' : 'primary'}
                loading={apply.isPending}
                onClick={run}
              >
                Importar
              </Button>
            </>
          }
        >
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{plural(plan.unitsToCreate, 'unidade nova', 'unidades novas')} no organograma</li>
            <li>{plural(plan.people.moved, 'pessoa muda', 'pessoas mudam')} de lotação</li>
            <li>
              {plural(plan.people.total, 'pessoa', 'pessoas')} na lista: só elas terão conta pelo AD
            </li>
            {plan.removal.count > 0 && (
              <li className="font-semibold text-danger">
                {plural(plan.removal.count, 'conta do AD', 'contas do AD')}{' '}
                {plan.removal.mode === 'delete'
                  ? plan.removal.count === 1
                    ? 'será excluída'
                    : 'serão excluídas'
                  : plan.removal.count === 1
                    ? 'será desativada'
                    : 'serão desativadas'}
              </li>
            )}
          </ul>
          {apply.isError && (
            <div className="mt-3">
              <Alert tone="error">{apply.error.message}</Alert>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Lê o arquivo como UTF-8; se vier em Windows-1252 (acentos quebrados), relê assim. */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

function Card({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{title}</h3>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Summary({ plan }: { plan: RosterPlan }) {
  const stats = [
    ['Pessoas', plan.people.total],
    ['Secretarias no arquivo', plan.secretarias.length],
    ['Setores', plan.setores.length],
    ['Unidades novas', plan.unitsToCreate],
  ] as const;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, n]) => (
          <div
            key={label}
            className="rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3"
          >
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-xl font-bold">{n}</dd>
          </div>
        ))}
      </dl>
      {!!plan.problems.length && (
        <details className="rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2 text-sm">
          <summary className="cursor-pointer font-semibold">
            {plural(plan.problems.length, 'aviso', 'avisos')} na leitura do arquivo
          </summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
            {plan.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const unitLabel = (u: OrgUnit) =>
  `${' '.repeat(u.depth * 3)}${u.acronym ? `${u.name} (${u.acronym})` : u.name}`;

function SecretariasSection({
  plan,
  units,
  decisions,
  onChange,
}: {
  plan: RosterPlan;
  units: OrgUnit[];
  decisions: Decisions;
  onChange: (d: Decisions) => void;
}) {
  const set = (raw: string, value: string) =>
    onChange({ ...decisions, secretarias: { ...decisions.secretarias, [raw]: value } });
  const creates = plan.secretarias.some((s) => s.target.endsWith('(nova)'));

  return (
    <Card
      title="Secretarias"
      description="Diga o que cada nome do arquivo é no organograma: uma unidade que já existe, uma secretaria nova ou o mesmo que outro nome do arquivo (ex.: FAZENDA é a SMF)."
    >
      <ul className="divide-y divide-line">
        {plan.secretarias.map((s) => (
          <li key={s.raw} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-40 flex-1">
              <p className="text-sm font-semibold">{s.raw}</p>
              <p className="text-xs text-muted">
                {plural(s.people, 'pessoa', 'pessoas')} · vai para {s.target}
              </p>
            </div>
            <select
              aria-label={`O que é ${s.raw}`}
              value={s.decision}
              onChange={(e) => set(s.raw, e.target.value)}
              className="h-9 w-full max-w-xs rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm hover:border-muted focus-visible:border-primary sm:w-80"
            >
              <option value="create">Criar a secretaria “{s.raw}”</option>
              <optgroup label="É o mesmo que, no arquivo">
                {plan.secretarias
                  .filter((o) => o.raw !== s.raw)
                  .map((o) => (
                    <option key={o.raw} value={`alias:${o.raw}`}>
                      Mesma que {o.raw}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Unidade que já existe">
                {units.map((u) => (
                  <option key={u.id} value={`existing:${u.id}`} disabled={!u.isActive}>
                    {unitLabel(u)}
                  </option>
                ))}
              </optgroup>
            </select>
          </li>
        ))}
      </ul>
      {creates && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <label htmlFor="roster-parent" className="text-sm font-semibold">
            Criar as secretarias novas dentro de
          </label>
          <select
            id="roster-parent"
            value={plan.parentId ?? ''}
            onChange={(e) => onChange({ ...decisions, parentId: e.target.value || null })}
            className="h-9 w-full max-w-xs rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm sm:w-80"
          >
            <option value="">Topo do organograma</option>
            {units.map((u) => (
              <option key={u.id} value={u.id} disabled={!u.isActive}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
          <p className="w-full text-xs text-muted">
            Depois dá para renomear no organograma (ex.: “SMF” → “Secretaria Municipal de Fazenda”,
            com a sigla SMF): a próxima importação reconhece pela sigla.
          </p>
        </div>
      )}
    </Card>
  );
}

function SetoresSection({
  plan,
  decisions,
  onChange,
}: {
  plan: RosterPlan;
  decisions: Decisions;
  onChange: (d: Decisions) => void;
}) {
  const [all, setAll] = useState(false);
  const conflicts = plan.setores.filter((s) => s.alternatives.length);
  const groups = useMemo(() => {
    const m = new Map<string, RosterSetor[]>();
    for (const s of plan.setores) {
      const k = s.secretaria ?? '(sem secretaria)';
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [plan.setores]);
  const move = (key: string, secretaria: string) =>
    onChange({ ...decisions, setores: { ...decisions.setores, [key]: secretaria } });

  const row = (s: RosterSetor, showSelect: boolean) => (
    <li key={s.key} className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-40 flex-1">
        <p className="text-sm font-semibold">
          {s.name}
          <span
            className={`ml-2 rounded px-1.5 py-px text-[11px] font-semibold ${s.isNew ? 'bg-primary/10 text-primary' : 'bg-line/60 text-muted'}`}
          >
            {s.isNew ? 'novo' : 'já existe'}
          </span>
        </p>
        <p className="text-xs text-muted">
          {plural(s.people, 'pessoa', 'pessoas')}
          {s.alternatives.length > 0 &&
            ` · também aparece em ${s.alternatives.map((a) => `${a.secretaria} (${a.people})`).join(', ')}`}
        </p>
      </div>
      {showSelect && (
        <select
          aria-label={`Secretaria do setor ${s.name}`}
          value={s.secretaria ?? ''}
          onChange={(e) => move(s.key, e.target.value)}
          className="h-9 w-full max-w-xs rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm sm:w-64"
        >
          {plan.secretarias.map((o) => (
            <option key={o.raw} value={o.raw}>
              em {o.raw}
            </option>
          ))}
        </select>
      )}
    </li>
  );

  return (
    <Card
      title="Setores"
      description="Cada setor fica na secretaria em que mais aparece no arquivo. Quando o mesmo setor aparece em mais de uma, confira abaixo."
    >
      {conflicts.length > 0 && (
        <div className="mb-4 rounded-[var(--radius-control)] border border-line bg-paper px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle size={15} className="text-danger" aria-hidden="true" />
            {plural(conflicts.length, 'setor aparece', 'setores aparecem')} em mais de uma
            secretaria
          </p>
          <ul className="divide-y divide-line">{conflicts.map((s) => row(s, true))}</ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setAll((v) => !v)}
        aria-expanded={all}
        className="text-sm font-semibold text-primary"
      >
        {all ? 'Esconder' : 'Ver'} todos os {plan.setores.length} setores por secretaria
      </button>
      {all && (
        <div className="mt-3 space-y-4">
          {groups.map(([sec, list]) => (
            <div key={sec}>
              <h4 className="text-xs font-bold tracking-wide text-muted uppercase">{sec}</h4>
              <ul className="divide-y divide-line">{list.map((s) => row(s, true))}</ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PeopleSection({ plan }: { plan: RosterPlan }) {
  const p = plan.people;
  return (
    <Card
      title="Pessoas"
      description={`${plural(p.moved, 'pessoa muda', 'pessoas mudam')} de lotação · ${plural(p.unchanged, 'já está', 'já estão')} no setor certo · ${plural(p.withoutAccount, 'ainda não tem', 'ainda não têm')} conta (ganham ao entrar pela primeira vez ou na próxima sincronização com o AD).`}
    >
      {p.changes.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Ver mudanças de lotação
          </summary>
          <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto text-sm">
            {p.changes.map((c) => (
              <li key={c.username} className="py-1.5">
                <span className="font-semibold">{c.displayName}</span>{' '}
                <span className="text-muted">({c.username})</span>
                <span className="block text-xs text-muted">
                  {c.from ?? 'sem lotação'} → {c.to ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="text-sm text-muted">Ninguém com conta muda de lotação.</p>
      )}
    </Card>
  );
}

function RemovalSection({
  plan,
  decisions,
  onChange,
  confirmLarge,
  setConfirmLarge,
}: {
  plan: RosterPlan;
  decisions: Decisions;
  onChange: (d: Decisions) => void;
  confirmLarge: boolean;
  setConfirmLarge: (v: boolean) => void;
}) {
  const r = plan.removal;
  return (
    <Card
      title="Contas do AD fora da lista"
      description="Quem entra pelo Active Directory e não está no arquivo. Contas locais e o super administrador nunca são removidos."
    >
      <fieldset className="mb-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <legend className="sr-only">O que fazer com quem está fora da lista</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="removal"
            checked={decisions.removal === 'delete'}
            onChange={() => onChange({ ...decisions, removal: 'delete' })}
            className="size-4 accent-[var(--color-primary)]"
          />
          Excluir as contas
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="removal"
            checked={decisions.removal === 'disable'}
            onChange={() => onChange({ ...decisions, removal: 'disable' })}
            className="size-4 accent-[var(--color-primary)]"
          />
          Só desativar (voltam se entrarem numa próxima lista)
        </label>
      </fieldset>
      {r.count === 0 ? (
        <p className="text-sm text-muted">Ninguém: todas as contas do AD estão na lista.</p>
      ) : (
        <>
          <p className="text-sm font-semibold text-danger">
            {plural(r.count, 'conta', 'contas')}{' '}
            {r.mode === 'delete'
              ? r.count === 1
                ? 'será excluída'
                : 'serão excluídas'
              : r.count === 1
                ? 'será desativada'
                : 'serão desativadas'}
            .
          </p>
          <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto text-sm">
            {r.people.map((p) => (
              <li key={p.username} className="py-1">
                {p.displayName} <span className="text-muted">({p.username})</span>
              </li>
            ))}
          </ul>
          {r.needsConfirmation && (
            <label className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-danger/40 bg-danger/5 p-3 text-sm">
              <input
                type="checkbox"
                checked={confirmLarge}
                onChange={(e) => setConfirmLarge(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-danger)]"
              />
              <span>
                É muita gente de uma vez. Confirmo que o arquivo está completo e que essas contas
                devem sair.
              </span>
            </label>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-muted">
        Depois da importação, a lista vale também para o AD: quem não está nela não ganha conta nem
        consegue entrar. A lotação deixa de vir das OUs (veja{' '}
        <Link to="/admin/active-directory" className="font-semibold text-primary">
          Active Directory
        </Link>
        ).
      </p>
    </Card>
  );
}
