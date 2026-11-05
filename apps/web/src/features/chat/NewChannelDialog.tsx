import type {
  ConversationSummary,
  CreateChannelRequest,
  DirectoryUser,
  PermissionScopes,
} from '@plataforma/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Avatar, Button, Dialog, IconButton, Select, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { canBroadcastTo, useOrgTree } from '../org/org-api';
import { upsertSummary } from './chat-api';
import { PersonPicker } from './PersonPicker';

/**
 * Novo canal de aviso. Ligado a uma unidade, as pessoas lotadas nela entram e saem
 * sozinhas; dá para acrescentar pessoas de fora escolhendo uma a uma.
 */
export function NewChannelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Novo canal de aviso"
      description="Só você e os administradores que escolher publicam. Os demais leem e podem reagir."
    >
      {open && <ChannelForm onDone={onClose} />}
    </Dialog>
  );
}

function ChannelForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { model } = useOrgTree();
  const scopes = useQuery({
    queryKey: ['scopes', 'conversations.create_channel'],
    queryFn: () => api<PermissionScopes>('GET', '/permissions/conversations.create_channel/scopes'),
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unitId, setUnitId] = useState('');
  const [includeSubunits, setIncludeSubunits] = useState(true);
  const [people, setPeople] = useState<DirectoryUser[]>([]);
  const [error, setError] = useState<string>();
  const create = useMutation({
    mutationFn: (b: CreateChannelRequest) =>
      api<ConversationSummary>('POST', '/conversations/channel', b),
    onSuccess: (c) => {
      upsertSummary(qc, c);
      onDone();
      void navigate(`/c/${c.id}`);
    },
  });

  // Unidades em que a pessoa pode criar canal, em ordem de árvore.
  const units = useMemo(() => {
    const out: { id: string; label: string; total: number; hasChildren: boolean }[] = [];
    const walk = (nodes: NonNullable<typeof model>['roots']) => {
      for (const n of nodes) {
        if (canBroadcastTo(scopes.data, n)) {
          out.push({
            id: n.id,
            label: `${' '.repeat(n.depth)}${n.name}${n.acronym ? ` (${n.acronym})` : ''}`,
            total: n.totalMembers,
            hasChildren: n.children.length > 0,
          });
        }
        walk(n.children);
      }
    };
    walk(model?.roots ?? []);
    return out;
  }, [model, scopes.data]);
  const unit = units.find((u) => u.id === unitId);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Informe o nome do canal');
    if (!unitId && !people.length) return setError('Escolha uma unidade ou ao menos uma pessoa');
    create.mutate({
      name: name.trim(),
      description: description.trim() || null,
      orgUnitId: unitId || null,
      includeSubunits,
      memberIds: people.map((p) => p.id),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {(error || create.error) && <Alert tone="error">{error ?? create.error?.message}</Alert>}
      <TextField
        label="Nome do canal"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ex.: Avisos da SEAD"
        autoFocus
        maxLength={120}
      />
      <TextField
        label="Descrição (opcional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
      />
      <div className="flex flex-col gap-2">
        <Select
          label="Membros automáticos"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          hint={
            unit
              ? `${unit.total} ${unit.total === 1 ? 'pessoa hoje' : 'pessoas hoje'}. Quem for lotado depois entra sozinho; quem sair, sai.`
              : 'Sem unidade, só as pessoas escolhidas abaixo.'
          }
        >
          <option value="">Nenhuma unidade</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </Select>
        {unit?.hasChildren && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSubunits}
              onChange={(e) => setIncludeSubunits(e.target.checked)}
              className="accent-[var(--color-primary)]"
            />
            Incluir as unidades abaixo
          </label>
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">
          Outras pessoas {people.length > 0 && `(${people.length})`}
        </p>
        {people.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {people.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-0.5 pr-1 pl-0.5 text-sm"
              >
                <Avatar name={p.displayName} src={p.avatarUrl} size={22} />
                {p.displayName.split(' ').slice(0, 2).join(' ')}
                <IconButton
                  label={`Remover ${p.displayName}`}
                  className="h-6 w-6"
                  onClick={() => setPeople((l) => l.filter((x) => x.id !== p.id))}
                >
                  <X size={13} aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <PersonPicker
          multiple
          selected={people}
          onToggle={(u) =>
            setPeople((l) =>
              l.some((x) => x.id === u.id) ? l.filter((x) => x.id !== u.id) : [...l, u],
            )
          }
          listClassName="max-h-48"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={create.isPending}>
          Criar canal
        </Button>
      </div>
    </form>
  );
}
