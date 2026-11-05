import { type DirectoryUser, ORG_UNIT_KINDS } from '@plataforma/contracts';
import {
  ArrowLeft,
  Briefcase,
  Building,
  Building2,
  ChevronRight,
  Landmark,
  Megaphone,
  MessageSquare,
  Network,
  Search,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Avatar, Button, Spinner, toast } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { useOpenDirect } from '../chat/chat-api';
import { usePresence, useWatchPresence } from '../chat/live-stores';
import { BroadcastComposer } from '../chat/BroadcastComposer';
import {
  canBroadcastTo,
  type TreeNode,
  useBroadcastScopes,
  useOrgTree,
  usePeopleSearch,
  useUnitPeople,
} from './org-api';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const KIND_ICON: Record<string, typeof Building2> = {
  orgao: Building2,
  secretaria: Landmark,
  subsecretaria: Building,
  coordenacao: Briefcase,
  setor: Users,
  outro: Users,
};

const unitLabel = (u: { name: string; acronym: string | null }) => u.acronym || u.name;

/**
 * Aba "Organograma": a árvore da organização à esquerda (órgão › secretarias ›
 * subsecretarias › setores, com as pessoas de cada unidade) e, à direita, os dados
 * da unidade ou da pessoa escolhida. No celular, uma coisa de cada vez.
 */
export function OrgDirectoryPage() {
  const tree = useOrgTree();
  const [params, setParams] = useSearchParams();
  const unitId = params.get('unidade');
  const [person, setPerson] = useState<DirectoryUser | null>(null);
  // Unidades cujo estado foi invertido pela pessoa: a raiz começa aberta, as demais fechadas.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (n: { id: string; depth: number }) => (n.depth === 0) !== toggled.has(n.id);
  const [query, setQuery] = useState('');

  const selected = unitId ? tree.model?.byId.get(unitId) : undefined;
  const showDetail = !!selected || !!person;

  function selectUnit(node: TreeNode, opts: { reveal?: boolean } = {}) {
    setPerson(null);
    setParams({ unidade: node.id });
    if (opts.reveal) {
      setToggled((s) => {
        const next = new Set(s);
        for (const u of [...node.ancestors, node]) {
          if (u.depth === 0) next.delete(u.id);
          else next.add(u.id);
        }
        return next;
      });
      setQuery('');
    }
  }
  const toggle = (id: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="relative flex h-full">
      <aside
        className={`flex w-full shrink-0 flex-col border-r border-line bg-surface md:w-80 lg:w-[24rem] ${showDetail ? 'hidden md:flex' : 'flex'}`}
      >
        <header className="flex items-center gap-2 px-4 pt-4 pb-2">
          <h1 className="flex-1 text-lg font-bold">Organograma</h1>
        </header>
        <div className="px-4 pb-3">
          <label className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-paper px-3 focus-within:border-primary">
            <Search size={15} className="text-muted" aria-hidden="true" />
            <span className="sr-only">Buscar setor ou pessoa</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar setor ou pessoa"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpar busca"
                className="text-muted hover:text-ink"
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {tree.isPending ? (
            <div className="flex justify-center py-10">
              <Spinner label="Carregando organograma" />
            </div>
          ) : tree.isError ? (
            <div className="px-4">
              <Alert tone="error">{tree.error.message}</Alert>
            </div>
          ) : query.trim() ? (
            <SearchResults
              query={query.trim()}
              nodes={[...tree.model!.byId.values()]}
              onUnit={(n) => selectUnit(n, { reveal: true })}
              onPerson={setPerson}
            />
          ) : tree.model!.roots.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              O organograma ainda não foi cadastrado.
            </p>
          ) : (
            <ul role="tree" aria-label="Unidades da organização" className="px-2">
              {tree.model!.roots.map((n) => (
                <UnitBranch
                  key={n.id}
                  node={n}
                  isOpen={isOpen}
                  selectedId={unitId}
                  personId={person?.id}
                  onToggle={toggle}
                  onSelect={(x) => selectUnit(x)}
                  onPerson={setPerson}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main
        className={`relative min-w-0 flex-1 bg-chat-bg ${showDetail ? 'flex' : 'hidden md:flex'}`}
      >
        {person ? (
          <PersonDetail
            key={person.id}
            person={person}
            onBack={() => setPerson(null)}
            onUnit={(id) => {
              const n = tree.model?.byId.get(id);
              if (n) selectUnit(n, { reveal: true });
            }}
          />
        ) : selected ? (
          <UnitDetail
            key={selected.id}
            node={selected}
            onBack={() => setParams({})}
            onUnit={(n) => selectUnit(n, { reveal: true })}
            onPerson={setPerson}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface text-primary">
                <Network size={26} aria-hidden="true" />
              </span>
              <h2 className="text-lg font-bold">Encontre setores e pessoas</h2>
              <p className="mt-1 text-sm text-muted">
                Abra as unidades na árvore ao lado ou busque pelo nome de um setor ou de uma pessoa.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------- Árvore -------------------------------- */

function OnlineBadge({ n }: { n: number }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold ${
        n > 0 ? 'bg-ok-soft text-ok' : 'bg-line/60 text-muted'
      }`}
    >
      {n} online
    </span>
  );
}

function UnitBranch({
  node,
  isOpen,
  selectedId,
  personId,
  onToggle,
  onSelect,
  onPerson,
}: {
  node: TreeNode;
  isOpen: (n: TreeNode) => boolean;
  selectedId: string | null;
  personId?: string;
  onToggle: (id: string) => void;
  onSelect: (n: TreeNode) => void;
  onPerson: (p: DirectoryUser) => void;
}) {
  const open = isOpen(node);
  const hasContent = node.children.length > 0 || node.memberCount > 0;
  const Icon = KIND_ICON[node.kind] ?? Users;
  const selected = selectedId === node.id;
  const top = node.depth === 0;

  return (
    <li role="treeitem" aria-expanded={hasContent ? open : undefined} aria-selected={selected}>
      <div
        className={`group flex items-center gap-1 rounded-[var(--radius-control)] pr-2 ${
          selected ? 'bg-primary-soft' : 'hover:bg-line/40'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          disabled={!hasContent}
          aria-label={open ? `Recolher ${node.name}` : `Abrir ${node.name}`}
          className="flex h-8 w-6 shrink-0 items-center justify-center text-muted disabled:invisible"
        >
          <ChevronRight
            size={15}
            aria-hidden="true"
            className={`transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </button>
        <button
          type="button"
          title={node.acronym ? `${node.name} (${node.acronym})` : node.name}
          onClick={() => {
            onSelect(node);
            if (!open && hasContent) onToggle(node.id);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <Icon size={16} aria-hidden="true" className="shrink-0 text-primary" />
          <span
            className={`min-w-0 flex-1 truncate ${top ? 'text-sm font-bold tracking-wide uppercase' : 'text-sm font-semibold'}`}
          >
            {node.name}
            {node.acronym && !top && (
              <span className="ml-1 font-normal text-muted">({node.acronym})</span>
            )}
          </span>
        </button>
        <OnlineBadge n={node.totalOnline} />
      </div>
      {open && (
        <ul role="group" className="ml-3 border-l border-line pl-2">
          {node.children.map((c) => (
            <UnitBranch
              key={c.id}
              node={c}
              isOpen={isOpen}
              selectedId={selectedId}
              personId={personId}
              onToggle={onToggle}
              onSelect={onSelect}
              onPerson={onPerson}
            />
          ))}
          {node.memberCount > 0 && (
            <UnitPeople node={node} personId={personId} onPerson={onPerson} />
          )}
        </ul>
      )}
    </li>
  );
}

function UnitPeople({
  node,
  personId,
  onPerson,
}: {
  node: TreeNode;
  personId?: string;
  onPerson: (p: DirectoryUser) => void;
}) {
  const people = useUnitPeople(node.id);
  useWatchPresence((people.data ?? []).map((p) => p.id));
  if (people.isPending)
    return (
      <li className="py-2 pl-8">
        <Spinner size={14} label="Carregando pessoas" />
      </li>
    );
  const where = [node.ancestors.at(-1), node]
    .filter(Boolean)
    .map((u) => unitLabel(u!))
    .join(' · ');
  return (
    <>
      {(people.data ?? []).map((p) => (
        <PersonRow
          key={p.id}
          person={p}
          subtitle={where}
          inTree
          active={personId === p.id}
          onClick={() => onPerson(p)}
        />
      ))}
    </>
  );
}

function PersonRow({
  person,
  subtitle,
  active,
  onClick,
  inTree = false,
}: {
  person: DirectoryUser;
  subtitle: string;
  active?: boolean;
  onClick: () => void;
  inTree?: boolean;
}) {
  const presence = usePresence(person.id);
  return (
    <li {...(inTree ? { role: 'treeitem', 'aria-selected': !!active } : {})}>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 text-left ${
          active ? 'bg-primary-soft' : 'hover:bg-line/40'
        }`}
      >
        <Avatar
          name={person.displayName}
          src={person.avatarUrl}
          size={40}
          presence={presence ?? 'offline'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{person.displayName}</span>
          <span className="block truncate text-[11px] tracking-wide text-muted uppercase">
            {person.jobTitle ? `${person.jobTitle} · ` : ''}
            {subtitle}
          </span>
        </span>
      </button>
    </li>
  );
}

function SearchResults({
  query,
  nodes,
  onUnit,
  onPerson,
}: {
  query: string;
  nodes: TreeNode[];
  onUnit: (n: TreeNode) => void;
  onPerson: (p: DirectoryUser) => void;
}) {
  const q = normalize(query);
  const units = useMemo(
    () =>
      nodes
        .filter((n) => normalize(n.name).includes(q) || normalize(n.acronym ?? '').includes(q))
        .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name, 'pt-BR'))
        .slice(0, 50),
    [nodes, q],
  );
  const people = usePeopleSearch(query);
  useWatchPresence((people.data ?? []).map((p) => p.id));

  return (
    <div className="px-2">
      <h2 className="px-2 pt-1 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
        Setores
      </h2>
      {units.length === 0 ? (
        <p className="px-2 pb-3 text-sm text-muted">Nenhum setor com esse nome.</p>
      ) : (
        <ul className="pb-3">
          {units.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? Users;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onUnit(n)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-line/40"
                >
                  <Icon size={18} aria-hidden="true" className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      <Highlight text={n.name} query={query} />
                      {n.acronym && (
                        <span className="ml-1 font-normal text-muted">
                          (<Highlight text={n.acronym} query={query} />)
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {n.ancestors.length
                        ? n.ancestors.map(unitLabel).join(' › ')
                        : ORG_UNIT_KINDS[n.kind]}
                    </span>
                  </span>
                  <OnlineBadge n={n.totalOnline} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h2 className="px-2 pt-1 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
        Pessoas
      </h2>
      {query.length < 2 ? (
        <p className="px-2 text-sm text-muted">Digite ao menos 2 letras.</p>
      ) : people.isPending ? (
        <div className="px-2 py-2">
          <Spinner size={14} label="Buscando pessoas" />
        </div>
      ) : (people.data ?? []).length === 0 ? (
        <p className="px-2 text-sm text-muted">Ninguém encontrado.</p>
      ) : (
        <ul>
          {people.data!.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              subtitle={p.orgUnit ? unitLabel(p.orgUnit) : 'Sem lotação'}
              onClick={() => onPerson(p)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = normalize(text).indexOf(normalize(query));
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-accent-soft text-ink">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

/* ------------------------------- Detalhes ------------------------------ */

function DetailHeader({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5 md:px-5">
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar ao organograma"
        className="rounded-[var(--radius-control)] p-1.5 text-muted hover:bg-line/50 md:hidden"
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </button>
      {children}
    </header>
  );
}

function UnitDetail({
  node,
  onBack,
  onUnit,
  onPerson,
}: {
  node: TreeNode;
  onBack: () => void;
  onUnit: (n: TreeNode) => void;
  onPerson: (p: DirectoryUser) => void;
}) {
  const scopes = useBroadcastScopes();
  const [broadcasting, setBroadcasting] = useState(false);
  const people = useUnitPeople(node.id);
  useWatchPresence((people.data ?? []).map((p) => p.id));
  const Icon = KIND_ICON[node.kind] ?? Users;
  const canBroadcast = canBroadcastTo(scopes.data, node);

  return (
    <div className="flex h-full w-full flex-col">
      <DetailHeader onBack={onBack}>
        <nav aria-label="Caminho" className="min-w-0 flex-1 truncate text-sm text-muted">
          {node.ancestors.map((a) => (
            <span key={a.id}>
              {unitLabel(a)}
              <span aria-hidden="true"> › </span>
            </span>
          ))}
          <span className="font-semibold text-ink">{unitLabel(node)}</span>
        </nav>
      </DetailHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
          <section className="flex flex-wrap items-start gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Icon size={26} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold tracking-wide text-muted uppercase">
                {ORG_UNIT_KINDS[node.kind]}
              </p>
              <h2 className="text-xl font-bold">
                {node.name}
                {node.acronym && (
                  <span className="ml-2 font-normal text-muted">{node.acronym}</span>
                )}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {node.totalMembers} {node.totalMembers === 1 ? 'pessoa' : 'pessoas'}
                {node.children.length > 0 && ' com as subunidades'} ·{' '}
                <span className={node.totalOnline ? 'font-semibold text-ok' : ''}>
                  {node.totalOnline} online agora
                </span>
              </p>
            </div>
            {canBroadcast && (
              <Button onClick={() => setBroadcasting(true)}>
                <Megaphone size={16} aria-hidden="true" /> Enviar comunicado
              </Button>
            )}
          </section>

          {node.children.length > 0 && (
            <section className="mt-6">
              <h3 className="mb-2 text-sm font-bold">Unidades subordinadas</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {node.children.map((c) => {
                  const CIcon = KIND_ICON[c.kind] ?? Users;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onUnit(c)}
                        className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-left hover:border-primary"
                      >
                        <CIcon size={17} aria-hidden="true" className="shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{c.name}</span>
                          <span className="block text-xs text-muted">
                            {c.totalMembers} {c.totalMembers === 1 ? 'pessoa' : 'pessoas'}
                          </span>
                        </span>
                        <OnlineBadge n={c.totalOnline} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-bold">
              Lotadas nesta unidade{' '}
              <span className="font-normal text-muted">({node.memberCount})</span>
            </h3>
            {people.isPending ? (
              <Spinner label="Carregando pessoas" />
            ) : (people.data ?? []).length === 0 ? (
              <p className="text-sm text-muted">Ninguém lotado diretamente aqui.</p>
            ) : (
              <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
                {people.data!.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    subtitle={unitLabel(node)}
                    onClick={() => onPerson(p)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {canBroadcast && (
        <BroadcastComposer
          open={broadcasting}
          onClose={() => setBroadcasting(false)}
          initialUnit={node}
        />
      )}
    </div>
  );
}

const PRESENCE_TEXT = { online: 'Disponível', away: 'Ausente', offline: 'Desconectado' } as const;

function PersonDetail({
  person,
  onBack,
  onUnit,
}: {
  person: DirectoryUser;
  onBack: () => void;
  onUnit: (unitId: string) => void;
}) {
  const presence = usePresence(person.id) ?? 'offline';
  useWatchPresence([person.id]);
  const open = useOpenDirect();
  const navigate = useNavigate();

  function message() {
    open.mutate(person.id, {
      onSuccess: (c) => void navigate(`/c/${c.id}`),
      onError: (e) =>
        toast(
          e instanceof ApiRequestError ? e.message : 'Não foi possível abrir a conversa.',
          'error',
        ),
    });
  }

  return (
    <div className="flex h-full w-full flex-col">
      <DetailHeader onBack={onBack}>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{person.displayName}</span>
      </DetailHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="mx-auto mt-8 flex max-w-md flex-col items-center rounded-[var(--radius-panel)] border border-line bg-surface px-6 py-8 text-center">
          <Avatar name={person.displayName} src={person.avatarUrl} size={112} presence={presence} />
          <h2 className="mt-4 text-xl font-bold">{person.displayName}</h2>
          {person.jobTitle && <p className="text-sm">{person.jobTitle}</p>}
          <p
            className={`mt-1 text-sm ${presence === 'online' ? 'font-semibold text-ok' : 'text-muted'}`}
          >
            {PRESENCE_TEXT[presence]}
          </p>
          {person.orgUnit && (
            <button
              type="button"
              onClick={() => onUnit(person.orgUnit!.id)}
              className="mt-3 text-sm font-semibold text-primary hover:underline"
            >
              {person.orgUnit.name}
              {person.orgUnit.acronym ? ` (${person.orgUnit.acronym})` : ''}
            </button>
          )}
          <p className="mt-1 text-xs text-muted">@{person.username}</p>
          {person.kind === 'guest' && (
            <p className="mt-2 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold">
              Convidado
            </p>
          )}
          <Button className="mt-6" onClick={message} loading={open.isPending}>
            <MessageSquare size={16} aria-hidden="true" /> Enviar mensagem
          </Button>
        </section>
      </div>
    </div>
  );
}
