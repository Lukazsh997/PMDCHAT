import type { DirectoryUser } from '@plataforma/contracts';
import { X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Dialog, TextField } from '@/components/ui';
import { useCreateGroup, useOpenDirect } from './chat-api';
import { PersonPicker } from './PersonPicker';

export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openDirect = useOpenDirect();
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Conversar com uma pessoa"
      description="Qualquer pessoa da organização pode receber mensagens."
    >
      {openDirect.error && <Alert tone="error">{openDirect.error.message}</Alert>}
      <PersonPicker
        autoFocus
        multiple={false}
        selected={[]}
        onToggle={(u) =>
          openDirect.mutate(u.id, {
            onSuccess: (c) => {
              onClose();
              void navigate(`/c/${c.id}`);
            },
          })
        }
      />
    </Dialog>
  );
}

export function NewGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState<DirectoryUser[]>([]);
  const [error, setError] = useState<string>();
  const create = useCreateGroup();
  const navigate = useNavigate();

  const toggle = (u: DirectoryUser) =>
    setMembers((m) => (m.some((x) => x.id === u.id) ? m.filter((x) => x.id !== u.id) : [...m, u]));
  const close = () => {
    setName('');
    setMembers([]);
    setError(undefined);
    create.reset();
    onClose();
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Informe o nome do grupo');
    create.mutate(
      { name: name.trim(), memberIds: members.map((m) => m.id) },
      {
        onSuccess: (c) => {
          close();
          void navigate(`/c/${c.id}`);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Novo grupo"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form="new-group" loading={create.isPending}>
            Criar grupo
          </Button>
        </>
      }
    >
      <form id="new-group" onSubmit={submit} className="flex flex-col gap-4">
        {create.error && <Alert tone="error">{create.error.message}</Alert>}
        <TextField
          label="Nome do grupo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          autoFocus
          maxLength={120}
        />
        <div>
          <p className="mb-2 text-sm font-semibold">
            Participantes {members.length > 0 && `(${members.length})`}
          </p>
          {members.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-1.5">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pr-1 pl-2.5 text-sm dark:bg-rail-ink/10"
                >
                  {m.displayName}
                  <button
                    type="button"
                    onClick={() => toggle(m)}
                    aria-label={`Remover ${m.displayName}`}
                    className="rounded-full p-0.5 hover:bg-line"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <PersonPicker multiple selected={members} onToggle={toggle} />
        </div>
      </form>
    </Dialog>
  );
}
