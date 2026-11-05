import type { ConversationSummary } from '@plataforma/contracts';
import { BellOff, Megaphone, MessageSquarePlus, Radio, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router';
import { Avatar, IconButton, Menu, Spinner } from '@/components/ui';
import { formatListTime } from '@/lib/format';
import { isMuted, useConversations } from './chat-api';
import { usePresence, useWatchPresence } from './live-stores';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function ConversationList({
  meId,
  onNewChat,
  onNewGroup,
  onBroadcast,
  onNewChannel,
  canCreate,
}: {
  onNewChannel?: () => void;
  meId: string;
  onNewChat: () => void;
  onNewGroup: () => void;
  onBroadcast: () => void;
  canCreate: boolean;
}) {
  const conversations = useConversations();
  const [filter, setFilter] = useState('');
  const items = useMemo(() => {
    const list = conversations.data ?? [];
    const q = normalize(filter.trim());
    return q ? list.filter((c) => normalize(c.title).includes(q)) : list;
  }, [conversations.data, filter]);
  useWatchPresence(items.flatMap((c) => (c.peer ? [c.peer.id] : [])));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <h1 className="flex-1 text-lg font-bold">Conversas</h1>
        {canCreate && (
          <button
            type="button"
            onClick={onBroadcast}
            title="Enviar a mesma mensagem para várias pessoas ou setores"
            className="flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary-soft px-3 text-sm font-semibold text-primary hover:border-primary"
          >
            <Megaphone size={16} aria-hidden="true" /> Comunicado
          </button>
        )}
        {canCreate && (
          <Menu
            label="Nova conversa"
            items={[
              {
                label: 'Conversa com uma pessoa',
                icon: <MessageSquarePlus size={16} aria-hidden="true" />,
                onSelect: onNewChat,
              },
              {
                label: 'Novo grupo',
                icon: <Users size={16} aria-hidden="true" />,
                onSelect: onNewGroup,
              },
              ...(onNewChannel
                ? [
                    {
                      label: 'Novo canal de aviso',
                      icon: <Radio size={16} aria-hidden="true" />,
                      onSelect: onNewChannel,
                    },
                  ]
                : []),
              {
                label: 'Comunicado para várias pessoas',
                icon: <Megaphone size={16} aria-hidden="true" />,
                onSelect: onBroadcast,
              },
            ]}
            trigger={(p) => (
              <IconButton label="Nova conversa" {...p}>
                <MessageSquarePlus size={19} aria-hidden="true" />
              </IconButton>
            )}
          />
        )}
      </header>
      <div className="px-4 pb-3">
        <label className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-paper px-3 focus-within:border-primary">
          <Search size={15} className="text-muted" aria-hidden="true" />
          <span className="sr-only">Filtrar conversas</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar conversas"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
      </div>

      <nav aria-label="Lista de conversas" className="min-h-0 flex-1 overflow-y-auto">
        {conversations.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner label="Carregando conversas" />
          </div>
        ) : items.length === 0 ? (
          <EmptyList filtered={!!filter} canCreate={canCreate} onNewChat={onNewChat} />
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.id}>
                <ConversationItem c={c} meId={meId} />
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function ConversationItem({ c, meId }: { c: ConversationSummary; meId: string }) {
  const presence = usePresence(c.peer?.id);
  const muted = isMuted(c);
  const last = c.lastMessage;
  let preview = c.type === 'group' && !last ? `${c.memberCount} participantes` : '';
  if (last) {
    if (last.type === 'system') preview = 'Atualização do grupo';
    else if (!last.text) preview = 'Mensagem apagada';
    else {
      const prefix =
        last.senderId === meId
          ? 'Você: '
          : c.type === 'group' && last.senderName
            ? `${last.senderName.split(' ')[0]}: `
            : '';
      preview = prefix + last.text;
    }
  }
  const unread = c.unreadCount > 0;

  return (
    <NavLink
      to={`/c/${c.id}`}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 focus-visible:outline-offset-[-2px] ${isActive ? 'bg-primary/10 dark:bg-rail-ink/10' : 'hover:bg-line/40'}`
      }
    >
      <Avatar
        name={c.title}
        size={44}
        src={c.peer?.avatarUrl}
        group={c.type === 'group'}
        channel={!!c.channel}
        presence={c.type === 'direct' ? (presence ?? 'offline') : undefined}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate ${unread ? 'font-bold' : 'font-semibold'}`}>
            {c.title}
          </span>
          <span
            className={`shrink-0 text-xs ${unread && !muted ? 'font-semibold text-ink' : 'text-muted'}`}
          >
            {formatListTime(last?.createdAt ?? c.lastMessageAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm ${unread ? 'text-ink' : 'text-muted'} ${last && !last.text && last.type === 'text' ? 'italic' : ''}`}
          >
            {preview}
          </span>
          {muted && <BellOff size={14} className="shrink-0 text-muted" aria-label="Silenciada" />}
          {c.unreadMentions > 0 && (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-ink"
              aria-label={`${c.unreadMentions} ${c.unreadMentions === 1 ? 'menção' : 'menções'} a você`}
              title="Mencionaram você"
            >
              @
            </span>
          )}
          {unread && (
            <span
              className={`min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs leading-5 font-bold ${muted ? 'bg-line text-muted' : 'bg-accent text-rail-strong'}`}
              aria-label={`${c.unreadCount} não lidas`}
            >
              {c.unreadCount > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </div>
      </div>
    </NavLink>
  );
}

function EmptyList({
  filtered,
  canCreate,
  onNewChat,
}: {
  filtered: boolean;
  canCreate: boolean;
  onNewChat: () => void;
}) {
  if (filtered)
    return (
      <p className="px-6 py-8 text-center text-sm text-muted">Nenhuma conversa com esse nome.</p>
    );
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-semibold">Nenhuma conversa ainda</p>
      <p className="mt-1 text-sm text-muted">
        {canCreate
          ? 'Procure uma pessoa pelo nome ou setor para começar.'
          : 'Você verá aqui as conversas em que for incluído.'}
      </p>
      {canCreate && (
        <button
          type="button"
          onClick={onNewChat}
          className="mt-4 text-sm font-semibold text-primary hover:underline"
        >
          Iniciar uma conversa
        </button>
      )}
    </div>
  );
}
