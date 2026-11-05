import { BROADCAST_RULES, type DirectoryUser, MESSAGE_RULES } from '@plataforma/contracts';
import { Check, Megaphone, Paperclip, Users, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Button, Dialog, IconButton, toast } from '@/components/ui';
import { newClientId } from '@/lib/format';
import {
  canBroadcastTo,
  type TreeNode,
  useBroadcastPreview,
  useBroadcastScopes,
  useOrgTree,
  useSendBroadcast,
} from '../org/org-api';
import { PendingAttachments, useAttachmentUploads } from './attachment-uploads';
import { PersonPicker } from './PersonPicker';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

interface UnitTarget {
  node: TreeNode;
  includeSubunits: boolean;
}

/**
 * Comunicado em massa numa tela só: escolher pessoas e setores na mesma busca,
 * escrever e enviar. Cada pessoa recebe em conversa particular com quem enviou.
 */
export function BroadcastComposer({
  open,
  onClose,
  initialUnit,
}: {
  open: boolean;
  onClose: () => void;
  initialUnit?: TreeNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Novo comunicado"
      description="Cada pessoa recebe em conversa particular com você. As respostas chegam só para você."
    >
      {open && <ComposerBody onDone={onClose} initialUnit={initialUnit} />}
    </Dialog>
  );
}

function ComposerBody({ onDone, initialUnit }: { onDone: () => void; initialUnit?: TreeNode }) {
  const tree = useOrgTree();
  const scopes = useBroadcastScopes();
  const [units, setUnits] = useState<UnitTarget[]>(
    initialUnit ? [{ node: initialUnit, includeSubunits: true }] : [],
  );
  const [people, setPeople] = useState<DirectoryUser[]>([]);
  const [text, setText] = useState('');
  const [clientId] = useState(newClientId);
  const uploads = useAttachmentUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const send = useSendBroadcast();

  // Setores que esta pessoa pode escolher (quem não tem a permissão escolhe só pessoas).
  const allowed = useMemo(
    () => [...(tree.model?.byId.values() ?? [])].filter((n) => canBroadcastTo(scopes.data, n)),
    [tree.model, scopes.data],
  );
  const limitedToPeople = !!scopes.data && !scopes.data.global && !scopes.data.unitIds.length;

  const targets = useMemo(
    () => ({
      units: units.map((u) => ({
        orgUnitId: u.node.id,
        includeSubunits: u.includeSubunits && u.node.children.length > 0,
      })),
      userIds: people.map((p) => p.id),
    }),
    [units, people],
  );
  const hasTargets = units.length > 0 || people.length > 0;
  // Só pessoas: a conta é local. Com setores, o servidor soma sem repetir ninguém.
  const preview = useBroadcastPreview(targets, units.length > 0);
  const count = units.length ? preview.data?.recipientCount : people.length;

  const tooManyPeople =
    limitedToPeople && people.length > BROADCAST_RULES.maxPeopleWithoutPermission;
  const canSend =
    hasTargets &&
    !!count &&
    !tooManyPeople &&
    !uploads.uploading &&
    !uploads.failed &&
    (text.trim().length > 0 || uploads.ready.length > 0) &&
    !send.isPending;

  function toggleUnit(node: TreeNode) {
    setUnits((list) =>
      list.some((u) => u.node.id === node.id)
        ? list.filter((u) => u.node.id !== node.id)
        : [...list, { node, includeSubunits: true }],
    );
  }
  function togglePerson(p: DirectoryUser) {
    setPeople((list) =>
      list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p],
    );
  }

  function submit() {
    if (!canSend) return;
    send.mutate(
      { ...targets, clientId, body: text, attachmentIds: uploads.ready.map((f) => f.id) },
      {
        onSuccess: (r) => {
          toast(
            `Comunicado enviado para ${r.recipientCount} ${r.recipientCount === 1 ? 'pessoa' : 'pessoas'}.`,
          );
          uploads.clear();
          onDone();
        },
      },
    );
  }

  const unitResults = (q: string) => {
    if (!allowed.length) return null;
    const term = normalize(q);
    const list = (
      term
        ? allowed.filter(
            (n) => normalize(n.name).includes(term) || normalize(n.acronym ?? '').includes(term),
          )
        : allowed.filter((n) => n.depth <= 1)
    )
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name, 'pt-BR'))
      .slice(0, term ? 8 : 6);
    if (!list.length) return null;
    return (
      <>
        <li className="px-2 pt-1 pb-0.5 text-[11px] font-bold tracking-wide text-muted uppercase">
          Setores
        </li>
        {list.map((n) => {
          const on = units.some((u) => u.node.id === n.id);
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => toggleUnit(n)}
                aria-pressed={on}
                className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-line/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Users size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {n.name}
                    {n.acronym && (
                      <span className="ml-1 font-normal text-muted">({n.acronym})</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {n.totalMembers} {n.totalMembers === 1 ? 'pessoa' : 'pessoas'}
                    {n.ancestors.length
                      ? ` · ${n.ancestors.map((a) => a.acronym || a.name).join(' › ')}`
                      : ''}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded border ${on ? 'border-primary bg-primary text-primary-ink' : 'border-line'}`}
                >
                  {on && <Check size={14} />}
                </span>
              </button>
            </li>
          );
        })}
        <li className="px-2 pt-2 pb-0.5 text-[11px] font-bold tracking-wide text-muted uppercase">
          Pessoas
        </li>
      </>
    );
  };

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      {send.isError && <Alert tone="error">{send.error.message}</Alert>}

      <section aria-label="Destinatários">
        <p className="mb-1.5 text-sm font-semibold">Para</p>
        {hasTargets && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {units.map((u) => (
              <li
                key={u.node.id}
                className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary-soft py-1 pr-1 pl-3 text-sm"
              >
                <Users size={14} aria-hidden="true" className="text-primary" />
                <span className="font-semibold">{u.node.acronym || u.node.name}</span>
                {u.node.children.length > 0 && (
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={u.includeSubunits}
                      onChange={(e) =>
                        setUnits((l) =>
                          l.map((x) =>
                            x.node.id === u.node.id
                              ? { ...x, includeSubunits: e.target.checked }
                              : x,
                          ),
                        )
                      }
                      className="accent-[var(--color-primary)]"
                    />
                    + subunidades
                  </label>
                )}
                <IconButton
                  label={`Remover ${u.node.name}`}
                  className="h-6 w-6"
                  onClick={() => toggleUnit(u.node)}
                >
                  <X size={13} aria-hidden="true" />
                </IconButton>
              </li>
            ))}
            {people.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-0.5 pr-1 pl-0.5 text-sm"
              >
                <Avatar name={p.displayName} src={p.avatarUrl} size={22} />
                <span>{p.displayName.split(' ').slice(0, 2).join(' ')}</span>
                <IconButton
                  label={`Remover ${p.displayName}`}
                  className="h-6 w-6"
                  onClick={() => togglePerson(p)}
                >
                  <X size={13} aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <PersonPicker
          multiple
          autoFocus={!initialUnit}
          selected={people}
          onToggle={togglePerson}
          placeholder={allowed.length ? 'Buscar pessoa ou setor' : 'Buscar pessoa'}
          extra={unitResults}
          listClassName="max-h-52"
        />
        {limitedToPeople && (
          <p className={`mt-1 text-xs ${tooManyPeople ? 'text-danger' : 'text-muted'}`}>
            Você pode escolher até {BROADCAST_RULES.maxPeopleWithoutPermission} pessoas. Para enviar
            a setores inteiros, peça o papel de Comunicador ao administrador.
          </p>
        )}
      </section>

      <section>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="broadcast-text">
          Mensagem
        </label>
        <textarea
          id="broadcast-text"
          autoFocus={!!initialUnit}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              uploads.add(files);
            }
          }}
          maxLength={MESSAGE_RULES.maxBodyLength}
          rows={4}
          placeholder="Escreva o comunicado"
          className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <PendingAttachments items={uploads.pending} onRemove={uploads.remove} />
      </section>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) uploads.add(e.target.files);
            e.target.value = '';
          }}
        />
        <Button variant="ghost" onClick={() => fileInput.current?.click()}>
          <Paperclip size={15} aria-hidden="true" /> Anexar
        </Button>
        <span className="flex-1 text-xs text-muted" aria-live="polite">
          {!hasTargets
            ? 'Escolha pessoas ou setores.'
            : count === undefined
              ? 'Contando destinatários…'
              : count === 0
                ? 'Ninguém ativo para receber.'
                : 'Ctrl+Enter envia.'}
        </span>
        <Button onClick={submit} disabled={!canSend} loading={send.isPending}>
          <Megaphone size={16} aria-hidden="true" />
          {count ? `Enviar para ${count} ${count === 1 ? 'pessoa' : 'pessoas'}` : 'Enviar'}
        </Button>
      </footer>
    </div>
  );
}
