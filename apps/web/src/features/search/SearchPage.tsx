import {
  type DirectoryUser,
  fileUrl,
  SEARCH_MARK,
  type SearchFileHit,
  type SearchMessagesPage,
} from '@plataforma/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download, FileText, MessageSquare, Search, Users, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Avatar, Button, Select, Spinner, toast } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { formatBytes, formatListTime } from '@/lib/format';
import { useConversations, useDirectory, useOpenDirect } from '../chat/chat-api';
import { usePresence, useWatchPresence } from '../chat/live-stores';

type Tab = 'tudo' | 'mensagens' | 'pessoas' | 'arquivos';
const TABS: { key: Tab; label: string }[] = [
  { key: 'tudo', label: 'Tudo' },
  { key: 'mensagens', label: 'Mensagens' },
  { key: 'pessoas', label: 'Pessoas' },
  { key: 'arquivos', label: 'Arquivos' },
];

/** Trecho com os termos encontrados em destaque (o servidor marca, aqui só se desenha). */
function Snippet({ text }: { text: string }) {
  const parts = text.split(SEARCH_MARK.start);
  return (
    <>
      {parts.map((part, i) => {
        if (i === 0) return part;
        const [hit, rest] = part.split(SEARCH_MARK.end);
        return (
          <span key={i}>
            <mark className="rounded-sm bg-accent-soft px-0.5 font-semibold text-ink">{hit}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}

/**
 * Busca global: mensagens (com filtros por conversa, pessoa e período), pessoas e
 * arquivos. O termo fica na URL (?q=…), então dá para voltar ao resultado.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tab = (params.get('tipo') as Tab) || 'tudo';
  const conversationId = params.get('conversa') ?? '';
  const from = params.get('de') ?? '';
  const to = params.get('ate') ?? '';
  const withFiles = params.get('anexo') === '1';
  const [sender, setSender] = useState<DirectoryUser | null>(null);
  const term = useDeferredValue(q.trim());
  const ready = term.length >= 2;
  const conversations = useConversations().data ?? [];
  const navigate = useNavigate();

  const set = (patch: Record<string, string>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const filterQs = new URLSearchParams({
    q: term,
    ...(conversationId ? { conversationId } : {}),
    ...(sender ? { senderId: sender.id } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(withFiles ? { withFiles: '1' } : {}),
  }).toString();

  const messages = useInfiniteQuery({
    queryKey: ['search', 'messages', filterQs],
    queryFn: ({ pageParam }) =>
      api<SearchMessagesPage>(
        'GET',
        `/search/messages?${filterQs}&limit=20${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore ? last.items.at(-1)?.message.createdAt : undefined),
    enabled: ready && (tab === 'tudo' || tab === 'mensagens'),
  });
  const people = useDirectory(term, ready && (tab === 'tudo' || tab === 'pessoas'));
  const files = useQuery({
    queryKey: ['search', 'files', term, conversationId],
    queryFn: () =>
      api<SearchFileHit[]>(
        'GET',
        `/search/files?q=${encodeURIComponent(term)}${conversationId ? `&conversationId=${conversationId}` : ''}`,
      ),
    enabled: ready && (tab === 'tudo' || tab === 'arquivos'),
  });

  const openMessage = (h: { conversationId: string; messageId: string; seq: number }) => {
    const qs = new URLSearchParams({ m: h.messageId, s: String(h.seq) });
    void navigate(`/c/${h.conversationId}?${qs.toString()}`);
  };

  const hits = messages.data?.pages.flatMap((p) => p.items) ?? [];
  const peopleList = (people.data ?? []).slice(0, tab === 'pessoas' ? 30 : 6);
  const fileList = (files.data ?? []).slice(0, tab === 'arquivos' ? 50 : 6);
  const showMessages = tab === 'tudo' || tab === 'mensagens';
  const filtersActive = !!(conversationId || sender || from || to || withFiles);

  return (
    <div className="h-full overflow-y-auto bg-chat-bg">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <h1 className="sr-only">Busca</h1>
        <label className="flex h-12 items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 shadow-sm focus-within:border-primary">
          <Search size={20} className="text-muted" aria-hidden="true" />
          <span className="sr-only">Buscar</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Buscar mensagens, pessoas e arquivos"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          />
          {q && (
            <button
              type="button"
              onClick={() => set({ q: '' })}
              aria-label="Limpar busca"
              className="text-muted hover:text-ink"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </label>

        <nav aria-label="Tipo de resultado" className="mt-4 flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => set({ tipo: t.key === 'tudo' ? '' : t.key })}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {showMessages && (
          <section aria-label="Filtros" className="mt-3 flex flex-wrap items-end gap-3 text-sm">
            <div className="w-56">
              <Select
                label="Conversa"
                value={conversationId}
                onChange={(e) => set({ conversa: e.target.value })}
              >
                <option value="">Todas</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </div>
            <SenderFilter value={sender} onChange={setSender} />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">De</span>
              <input
                type="date"
                value={from}
                onChange={(e) => set({ de: e.target.value })}
                className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Até</span>
              <input
                type="date"
                value={to}
                onChange={(e) => set({ ate: e.target.value })}
                className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-2"
              />
            </label>
            <label className="flex h-10 items-center gap-2">
              <input
                type="checkbox"
                checked={withFiles}
                onChange={(e) => set({ anexo: e.target.checked ? '1' : '' })}
                className="accent-[var(--color-primary)]"
              />
              Só com anexo
            </label>
            {filtersActive && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSender(null);
                  set({ conversa: '', de: '', ate: '', anexo: '' });
                }}
              >
                Limpar filtros
              </Button>
            )}
          </section>
        )}

        {!ready ? (
          <p className="mt-10 text-center text-sm text-muted">
            Digite ao menos 2 letras. Acentos não importam, e pedaços de palavras também encontram:
            "edit" acha "edital".
          </p>
        ) : (
          <div className="mt-5 flex flex-col gap-7">
            {(tab === 'tudo' || tab === 'pessoas') && (
              <section>
                <h2 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
                  Pessoas
                </h2>
                {people.isPending ? (
                  <Spinner size={16} label="Buscando pessoas" />
                ) : peopleList.length === 0 ? (
                  <p className="text-sm text-muted">Ninguém com esse nome.</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {peopleList.map((p) => (
                      <PersonHit key={p.id} person={p} />
                    ))}
                  </ul>
                )}
              </section>
            )}

            {showMessages && (
              <section>
                <h2 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
                  Mensagens
                </h2>
                {messages.isPending ? (
                  <Spinner size={16} label="Buscando mensagens" />
                ) : messages.isError ? (
                  <Alert tone="error">{messages.error.message}</Alert>
                ) : hits.length === 0 ? (
                  <p className="text-sm text-muted">Nenhuma mensagem encontrada.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-2">
                      {hits.map((h) => (
                        <li key={h.message.id}>
                          <button
                            type="button"
                            onClick={() =>
                              openMessage({
                                conversationId: h.conversation.id,
                                messageId: h.message.id,
                                seq: h.message.seq,
                              })
                            }
                            className="flex w-full gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 text-left hover:border-primary"
                          >
                            <span className="mt-0.5 shrink-0 text-muted">
                              {h.conversation.type === 'group' ? (
                                <Users size={18} aria-hidden="true" />
                              ) : (
                                <MessageSquare size={18} aria-hidden="true" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2 text-sm">
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-semibold">{h.senderName}</span>
                                  {h.conversation.type === 'group' && (
                                    <span className="text-muted"> em {h.conversation.title}</span>
                                  )}
                                </span>
                                <span className="shrink-0 text-xs text-muted">
                                  {formatListTime(h.message.createdAt)}
                                </span>
                              </span>
                              <span className="mt-0.5 line-clamp-3 block text-sm break-words">
                                <Snippet text={h.snippet} />
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {messages.hasNextPage && (
                      <div className="mt-3 flex justify-center">
                        <Button
                          variant="secondary"
                          loading={messages.isFetchingNextPage}
                          onClick={() => void messages.fetchNextPage()}
                        >
                          Mostrar mais antigas
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {(tab === 'tudo' || tab === 'arquivos') && (
              <section>
                <h2 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
                  Arquivos
                </h2>
                {files.isPending ? (
                  <Spinner size={16} label="Buscando arquivos" />
                ) : fileList.length === 0 ? (
                  <p className="text-sm text-muted">Nenhum arquivo com esse nome.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {fileList.map((f) => (
                      <li
                        key={f.file.id}
                        className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-2.5"
                      >
                        <FileText size={22} className="shrink-0 text-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {f.file.name}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {formatBytes(f.file.sizeBytes)} · {f.senderName}
                            {f.conversation.type === 'group'
                              ? ` em ${f.conversation.title}`
                              : ''} · {formatListTime(f.createdAt)}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            openMessage({
                              conversationId: f.conversation.id,
                              messageId: f.messageId,
                              seq: f.seq,
                            })
                          }
                        >
                          Ver na conversa
                        </Button>
                        <a
                          href={`${fileUrl(f.file.id)}?download=1`}
                          aria-label={`Baixar ${f.file.name}`}
                          className="rounded-[var(--radius-control)] p-2 text-muted hover:bg-line/50 hover:text-ink"
                        >
                          <Download size={18} aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PersonHit({ person }: { person: DirectoryUser }) {
  const presence = usePresence(person.id);
  useWatchPresence([person.id]);
  const open = useOpenDirect();
  const navigate = useNavigate();
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          open.mutate(person.id, {
            onSuccess: (c) => void navigate(`/c/${c.id}`),
            onError: (e) =>
              toast(e instanceof ApiRequestError ? e.message : 'Não foi possível abrir.', 'error'),
          })
        }
        className="flex w-full items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-3 py-2.5 text-left hover:border-primary"
      >
        <Avatar
          name={person.displayName}
          src={person.avatarUrl}
          size={40}
          presence={presence ?? 'offline'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{person.displayName}</span>
          <span className="block truncate text-xs text-muted">
            {[person.jobTitle, person.orgUnit?.acronym ?? person.orgUnit?.name]
              .filter(Boolean)
              .join(' · ') || person.username}
          </span>
        </span>
        <MessageSquare size={16} className="text-muted" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Filtro "enviada por": busca a pessoa no diretório. */
function SenderFilter({
  value,
  onChange,
}: {
  value: DirectoryUser | null;
  onChange: (u: DirectoryUser | null) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const found = useDirectory(q.trim(), open && q.trim().length >= 2);
  if (value) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Enviada por</span>
        <span className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-primary/50 bg-primary-soft px-2">
          <Avatar name={value.displayName} src={value.avatarUrl} size={22} />
          <span className="max-w-40 truncate">{value.displayName}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Tirar filtro de pessoa"
            className="text-muted hover:text-ink"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor="sender-filter" className="text-sm font-semibold">
        Enviada por
      </label>
      <input
        id="sender-filter"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Qualquer pessoa"
        className="h-10 w-48 rounded-[var(--radius-control)] border border-line bg-surface px-2"
      />
      {open && (found.data ?? []).length > 0 && (
        <ul className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface py-1 shadow-lg">
          {found.data!.slice(0, 6).map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(u);
                  setQ('');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-line/40"
              >
                <Avatar name={u.displayName} src={u.avatarUrl} size={24} />
                <span className="truncate">{u.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
