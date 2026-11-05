import type { DirectoryUser } from '@plataforma/contracts';
import { Check, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Avatar, Spinner } from '@/components/ui';
import { useDirectory } from './chat-api';

/** Busca no diretório por nome, usuário, cargo ou setor. */
export function PersonPicker({
  selected,
  onToggle,
  exclude = [],
  multiple,
  autoFocus,
}: {
  selected: DirectoryUser[];
  onToggle: (u: DirectoryUser) => void;
  exclude?: string[];
  multiple: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q.trim());
  const people = useDirectory(deferred);
  const list = (people.data ?? []).filter((u) => !exclude.includes(u.id));
  const isSelected = (u: DirectoryUser) => selected.some((s) => s.id === u.id);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 focus-within:border-primary">
        <Search size={16} className="text-muted" aria-hidden="true" />
        <span className="sr-only">Buscar pessoas</span>
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome, cargo ou setor"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
        {people.isFetching && <Spinner size={14} />}
      </label>
      <ul className="-mx-2 max-h-80 overflow-y-auto" aria-label="Pessoas encontradas">
        {list.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onToggle(u)}
              aria-pressed={multiple ? isSelected(u) : undefined}
              className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-line/40"
            >
              <Avatar name={u.displayName} size={36} src={u.avatarUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {u.displayName}
                  {u.kind === 'guest' && (
                    <span className="ml-2 text-xs font-normal text-muted">convidado</span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted">
                  {[u.jobTitle, u.orgUnit?.acronym ?? u.orgUnit?.name].filter(Boolean).join(', ') ||
                    u.username}
                </span>
              </span>
              {multiple && (
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded border ${isSelected(u) ? 'border-primary bg-primary text-primary-ink' : 'border-line'}`}
                >
                  {isSelected(u) && <Check size={14} />}
                </span>
              )}
            </button>
          </li>
        ))}
        {!people.isPending && list.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted">
            {deferred ? 'Ninguém encontrado com esse termo.' : 'Digite para buscar.'}
          </li>
        )}
      </ul>
    </div>
  );
}
