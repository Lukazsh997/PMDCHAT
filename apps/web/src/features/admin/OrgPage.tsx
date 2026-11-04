import { ORG_UNIT_KINDS, type OrgUnit, type OrgUnitKind } from '@plataforma/contracts';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  Select,
  Spinner,
  TextField,
  toast,
} from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { useMe } from '../auth/auth-api';
import { useOrgMutations, useOrgUnits } from './admin-api';
import { OrgUnitSelect } from './OrgUnitSelect';

type Editing = { mode: 'create'; parentId: string | null } | { mode: 'edit'; unit: OrgUnit };

/** Organograma: secretarias, subsecretarias, setores e qualquer outro nível. */
export function OrgPage() {
  const me = useMe().data!;
  const canManage = me.permissions.includes('org.manage');
  const units = useOrgUnits();
  const m = useOrgMutations();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<OrgUnit | null>(null);
  const list = units.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-5">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-sm text-muted">
          {list.length} unidades. Papéis de administração dados numa unidade valem também para as
          unidades abaixo dela.
        </p>
        {canManage && (
          <Button onClick={() => setEditing({ mode: 'create', parentId: null })}>
            <Plus size={16} aria-hidden="true" /> Nova unidade
          </Button>
        )}
      </div>

      {units.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner label="Carregando organograma" />
        </div>
      ) : list.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-panel)] border border-dashed border-line px-6 py-10 text-center">
          <p className="font-semibold">O organograma está vazio</p>
          <p className="mt-1 text-sm text-muted">
            Comece pela unidade mais alta, como o órgão ou uma secretaria.
          </p>
        </div>
      ) : (
        <ul
          className="mt-4 divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface"
          aria-label="Organograma"
        >
          {list.map((u) => (
            <li
              key={u.id}
              className={`flex items-center gap-3 py-2.5 pr-3 ${u.isActive ? '' : 'opacity-60'}`}
              style={{ paddingLeft: `${1 + u.depth * 1.5}rem` }}
            >
              {u.depth > 0 && <span aria-hidden="true" className="-ml-3 h-px w-3 bg-line" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {u.name}
                  {u.acronym && <span className="ml-2 font-normal text-muted">{u.acronym}</span>}
                </p>
                <p className="text-xs text-muted">
                  {ORG_UNIT_KINDS[u.kind]}
                  {`, ${u.memberCount} ${u.memberCount === 1 ? 'pessoa lotada' : 'pessoas lotadas'}`}
                  {!u.isActive && ', inativa'}
                </p>
              </div>
              {canManage && (
                <>
                  <IconButton
                    label={`Adicionar unidade dentro de ${u.name}`}
                    onClick={() => setEditing({ mode: 'create', parentId: u.id })}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Editar ${u.name}`}
                    onClick={() => setEditing({ mode: 'edit', unit: u })}
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton label={`Excluir ${u.name}`} onClick={() => setRemoving(u)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <UnitDialog editing={editing} units={list} onClose={() => setEditing(null)} />}
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title={`Excluir ${removing?.name ?? ''}?`}
        description="Só é possível excluir unidades sem subordinadas e sem pessoas lotadas. Para preservar o histórico, prefira desativar."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={m.remove.isPending}
              onClick={() =>
                m.remove.mutate(removing!.id, {
                  onSuccess: () => {
                    toast('Unidade excluída.');
                    setRemoving(null);
                  },
                  onError: (e) => {
                    toast(e.message, 'error');
                    setRemoving(null);
                  },
                })
              }
            >
              Excluir
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </div>
  );
}

function UnitDialog({
  editing,
  units,
  onClose,
}: {
  editing: Editing;
  units: OrgUnit[];
  onClose: () => void;
}) {
  const m = useOrgMutations();
  const unit = editing.mode === 'edit' ? editing.unit : null;
  const [name, setName] = useState(unit?.name ?? '');
  const [acronym, setAcronym] = useState(unit?.acronym ?? '');
  const [kind, setKind] = useState<OrgUnitKind>(
    unit?.kind ?? (editing.mode === 'create' && editing.parentId ? 'setor' : 'secretaria'),
  );
  const [parentId, setParentId] = useState(
    unit ? (unit.parentId ?? '') : editing.mode === 'create' ? (editing.parentId ?? '') : '',
  );
  const [isActive, setIsActive] = useState(unit?.isActive ?? true);
  const mutation = unit ? m.update : m.create;
  const err = mutation.error instanceof ApiRequestError ? mutation.error : null;
  const fields = err
    ? Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]]))
    : {};

  // Ao mover, não pode escolher a própria unidade nem uma subordinada a ela.
  const descendants = new Set<string>();
  if (unit) {
    descendants.add(unit.id);
    for (const u of units) if (u.parentId && descendants.has(u.parentId)) descendants.add(u.id);
  }

  function save() {
    const body = {
      name: name.trim(),
      acronym: acronym.trim() || null,
      kind,
      parentId: parentId || null,
    };
    const onSuccess = () => {
      toast(unit ? 'Unidade atualizada.' : 'Unidade criada.');
      onClose();
    };
    if (unit) m.update.mutate({ id: unit.id, body: { ...body, isActive } }, { onSuccess });
    else m.create.mutate(body, { onSuccess });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={unit ? 'Editar unidade' : 'Nova unidade'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={mutation.isPending} onClick={save}>
            {unit ? 'Salvar' : 'Criar unidade'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {err && !Object.keys(fields).length && (
          <div className="sm:col-span-2">
            <Alert tone="error">{err.message}</Alert>
          </div>
        )}
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
          autoFocus
          className="sm:col-span-2"
        />
        <TextField
          label="Sigla"
          value={acronym}
          onChange={(e) => setAcronym(e.target.value.toUpperCase())}
          hint="Opcional. Ex.: SEAD"
          maxLength={24}
        />
        <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as OrgUnitKind)}>
          {Object.entries(ORG_UNIT_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <div className="sm:col-span-2">
          <OrgUnitSelect
            label="Fica dentro de"
            emptyLabel="Nenhuma (nível mais alto)"
            units={units}
            value={parentId}
            onChange={setParentId}
            exclude={(u) => descendants.has(u.id)}
            error={fields.parentId}
            hint={unit ? 'Mudar aqui move a unidade junto com todas as subordinadas.' : undefined}
          />
        </div>
        {unit && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Unidade ativa (unidades inativas não podem receber novas lotações)
          </label>
        )}
      </div>
    </Dialog>
  );
}
