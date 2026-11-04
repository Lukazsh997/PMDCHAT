import type { ConversationDetail, DirectoryUser } from '@plataforma/contracts';
import { Bell, BellOff, LogOut, MoreHorizontal, Pencil, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Avatar, Button, Dialog, IconButton, Menu, TextField, toast } from '@/components/ui';
import { isMuted, useGroupActions } from './chat-api';
import { usePresence, useWatchPresence } from './live-stores';
import { PersonPicker } from './PersonPicker';

const ROLE_LABEL = { owner: 'Dono', admin: 'Administrador', member: '' } as const;

/** Painel lateral com participantes e opções da conversa. */
export function ConversationInfo({
  detail,
  meId,
  onClose,
}: {
  detail: ConversationDetail;
  meId: string;
  onClose: () => void;
}) {
  const actions = useGroupActions(detail.id);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const isGroup = detail.type === 'group';
  const amAdmin = detail.myRole !== 'member';
  const muted = isMuted(detail);
  useWatchPresence(detail.members.map((m) => m.id));

  const mute = (hours: number | null) =>
    actions.mute.mutate(
      hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString(),
    );

  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-surface lg:w-80">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 font-bold">{isGroup ? 'Dados do grupo' : 'Dados do contato'}</h2>
        <IconButton label="Fechar painel" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col items-center px-4 py-6 text-center">
          <Avatar name={detail.title} size={80} group={isGroup} />
          <p className="mt-3 text-lg font-bold">{detail.title}</p>
          {detail.peer ? (
            <p className="text-sm text-muted">
              {[detail.peer.jobTitle, detail.peer.orgUnit?.name].filter(Boolean).join(', ') ||
                detail.peer.username}
            </p>
          ) : (
            <p className="text-sm text-muted">{detail.memberCount} participantes</p>
          )}
          {detail.description && <p className="mt-2 text-sm">{detail.description}</p>}
          {isGroup && amAdmin && (
            <Button variant="ghost" className="mt-2" onClick={() => setRenaming(true)}>
              <Pencil size={15} aria-hidden="true" /> Editar nome e descrição
            </Button>
          )}
        </section>

        <section className="border-t border-line px-4 py-3">
          {muted ? (
            <Button variant="ghost" className="-ml-3" onClick={() => mute(null)}>
              <Bell size={16} aria-hidden="true" /> Reativar notificações
            </Button>
          ) : (
            <Menu
              label="Silenciar"
              align="left"
              items={[
                { label: 'Por 8 horas', onSelect: () => mute(8) },
                { label: 'Por 1 semana', onSelect: () => mute(24 * 7) },
                { label: 'Sempre', onSelect: () => mute(24 * 365 * 10) },
              ]}
              trigger={(p) => (
                <Button variant="ghost" className="-ml-3" {...p}>
                  <BellOff size={16} aria-hidden="true" /> Silenciar notificações
                </Button>
              )}
            />
          )}
        </section>

        {isGroup && (
          <section className="border-t border-line py-3">
            <div className="flex items-center px-4 pb-1">
              <h3 className="flex-1 text-sm font-bold">{detail.members.length} participantes</h3>
              {amAdmin && (
                <Button variant="ghost" onClick={() => setAdding(true)}>
                  <UserPlus size={15} aria-hidden="true" /> Adicionar
                </Button>
              )}
            </div>
            <ul>
              {detail.members.map((m) => (
                <Member
                  key={m.id}
                  member={m}
                  isMe={m.id === meId}
                  canManage={
                    amAdmin &&
                    m.role !== 'owner' &&
                    m.id !== meId &&
                    (detail.myRole === 'owner' || m.role === 'member')
                  }
                  canPromote={amAdmin}
                  onRemove={() =>
                    actions.remove.mutate(m.id, { onError: (e) => toast(e.message, 'error') })
                  }
                  onRole={(role) =>
                    actions.setRole.mutate(
                      { userId: m.id, role },
                      { onError: (e) => toast(e.message, 'error') },
                    )
                  }
                />
              ))}
            </ul>
          </section>
        )}

        {isGroup && (
          <section className="border-t border-line px-4 py-3">
            <Button variant="danger" onClick={() => setConfirmLeave(true)}>
              <LogOut size={16} aria-hidden="true" /> Sair do grupo
            </Button>
          </section>
        )}
      </div>

      <AddMembersDialog
        open={adding}
        onClose={() => setAdding(false)}
        exclude={detail.members.map((m) => m.id)}
        loading={actions.add.isPending}
        error={actions.add.error?.message}
        onAdd={(ids) => actions.add.mutate(ids, { onSuccess: () => setAdding(false) })}
      />
      <RenameDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        detail={detail}
        actions={actions}
      />
      <Dialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        size="sm"
        title="Sair do grupo?"
        description="Você deixa de receber as mensagens. Para voltar, um administrador precisa adicionar você de novo."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={actions.remove.isPending}
              onClick={() =>
                actions.remove.mutate(meId, {
                  onSuccess: () => void navigate('/'),
                  onError: (e) => toast(e.message, 'error'),
                })
              }
            >
              Sair do grupo
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </aside>
  );
}

function Member({
  member,
  isMe,
  canManage,
  canPromote,
  onRemove,
  onRole,
}: {
  member: ConversationDetail['members'][number];
  isMe: boolean;
  canManage: boolean;
  canPromote: boolean;
  onRemove: () => void;
  onRole: (r: 'admin' | 'member') => void;
}) {
  const presence = usePresence(member.id);
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <Avatar name={member.displayName} size={36} presence={presence ?? 'offline'} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {isMe ? 'Você' : member.displayName}
          {member.kind === 'guest' && (
            <span className="ml-1.5 text-xs font-normal text-muted">convidado</span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {member.orgUnit?.acronym ?? member.orgUnit?.name ?? member.jobTitle ?? ''}
        </p>
      </div>
      {ROLE_LABEL[member.role] && (
        <span className="text-xs font-semibold text-muted">{ROLE_LABEL[member.role]}</span>
      )}
      {canManage && (
        <Menu
          label={`Opções para ${member.displayName}`}
          items={[
            ...(canPromote && member.role === 'member'
              ? [{ label: 'Tornar administrador', onSelect: () => onRole('admin') }]
              : []),
            ...(member.role === 'admin'
              ? [{ label: 'Remover de administrador', onSelect: () => onRole('member') }]
              : []),
            { label: 'Remover do grupo', danger: true, onSelect: onRemove },
          ]}
          trigger={(p) => (
            <IconButton label={`Opções para ${member.displayName}`} className="h-8 w-8" {...p}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </IconButton>
          )}
        />
      )}
    </li>
  );
}

function AddMembersDialog({
  open,
  onClose,
  exclude,
  onAdd,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  exclude: string[];
  onAdd: (ids: string[]) => void;
  loading: boolean;
  error?: string;
}) {
  const [sel, setSel] = useState<DirectoryUser[]>([]);
  const close = () => {
    setSel([]);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Adicionar participantes"
      description="Quem entra agora vê as mensagens a partir deste momento."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button
            disabled={!sel.length}
            loading={loading}
            onClick={() => onAdd(sel.map((s) => s.id))}
          >
            Adicionar {sel.length > 0 && `(${sel.length})`}
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <PersonPicker
        autoFocus
        multiple
        exclude={exclude}
        selected={sel}
        onToggle={(u) =>
          setSel((s) => (s.some((x) => x.id === u.id) ? s.filter((x) => x.id !== u.id) : [...s, u]))
        }
      />
    </Dialog>
  );
}

function RenameDialog({
  open,
  onClose,
  detail,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  detail: ConversationDetail;
  actions: ReturnType<typeof useGroupActions>;
}) {
  const [name, setName] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? '');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Editar grupo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={actions.rename.isPending}
            onClick={() =>
              actions.rename.mutate(
                { name: name.trim(), description: description.trim() || null },
                { onSuccess: onClose },
              )
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {actions.rename.error && <Alert tone="error">{actions.rename.error.message}</Alert>}
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        <TextField
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          hint="Opcional"
        />
      </div>
    </Dialog>
  );
}
