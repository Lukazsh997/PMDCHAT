import type { OrgUnit } from '@plataforma/contracts';
import { Building2, Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, Button, Spinner } from '@/components/ui';
import { ORG_NAME } from '@/lib/config';
import { useChooseOrgUnit, useLogout, useOnboardingOrgUnits } from './auth-api';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Primeiro acesso de quem entrou pelo AD sem estar na lista de lotação: escolhe o próprio
 * setor. A autenticação continua sendo a do AD; aqui só se define onde a pessoa trabalha.
 */
export function ChooseOrgUnitPage({ displayName }: { displayName: string }) {
  const units = useOnboardingOrgUnits();
  const choose = useChooseOrgUnit();
  const logout = useLogout();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // Caminho de cada unidade (Secretaria › Setor), para escolher sem ambiguidade.
  const pathOf = useMemo(() => {
    const byId = new Map((units.data ?? []).map((u) => [u.id, u]));
    const path = (u: OrgUnit): string => {
      const parts: string[] = [];
      let cur: OrgUnit | undefined = u.parentId ? byId.get(u.parentId) : undefined;
      while (cur) {
        parts.unshift(cur.acronym || cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return parts.join(' › ');
    };
    return new Map((units.data ?? []).map((u) => [u.id, path(u)]));
  }, [units.data]);

  const results = useMemo(() => {
    const all = units.data ?? [];
    const q = normalize(query.trim());
    const list = q
      ? all.filter(
          (u) =>
            normalize(u.name).includes(q) ||
            normalize(u.acronym ?? '').includes(q) ||
            normalize(pathOf.get(u.id) ?? '').includes(q),
        )
      : all;
    return list.slice(0, 200);
  }, [units.data, query, pathOf]);

  const confirm = () => {
    if (selected) choose.mutate(selected);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 py-10">
      <p className="text-sm text-muted">{ORG_NAME}</p>
      <h1 className="mt-1 text-xl font-bold">Em qual setor você trabalha?</h1>
      <p className="mt-1 mb-5 text-sm text-muted">
        {displayName}, você entrou com a conta da rede. Escolha o seu setor para começar a usar o
        sistema. Se errar, um administrador pode corrigir depois.
      </p>

      {units.isPending ? (
        <Spinner label="Carregando setores" />
      ) : units.isError ? (
        <Alert tone="error">{units.error.message}</Alert>
      ) : (
        <>
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Procurar setor ou secretaria"
              aria-label="Procurar setor"
              className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-3 pl-9 text-sm hover:border-muted focus-visible:border-primary"
            />
          </div>

          <ul
            role="listbox"
            aria-label="Setores"
            className="mt-3 flex-1 divide-y divide-line overflow-y-auto rounded-[var(--radius-control)] border border-line"
          >
            {results.map((u) => {
              const path = pathOf.get(u.id);
              const on = selected === u.id;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => setSelected(u.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${on ? 'bg-primary/10' : 'hover:bg-line/40'}`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Building2 size={16} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {u.name}
                        {u.acronym && (
                          <span className="ml-1 font-normal text-muted">({u.acronym})</span>
                        )}
                      </span>
                      {path && <span className="block truncate text-xs text-muted">{path}</span>}
                    </span>
                    {on && <Check size={18} className="shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
            {!results.length && (
              <li className="px-3 py-6 text-center text-sm text-muted">
                Nenhum setor encontrado para “{query}”.
              </li>
            )}
          </ul>

          {choose.isError && (
            <div className="mt-3">
              <Alert tone="error">{choose.error.message}</Alert>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="ghost" className="-ml-4" onClick={() => logout.mutate()}>
              Sair
            </Button>
            <Button disabled={!selected} loading={choose.isPending} onClick={confirm}>
              Confirmar setor
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
