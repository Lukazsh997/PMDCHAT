import { ArrowLeft, Info, Megaphone, Upload } from 'lucide-react';
import { MESSAGE_RULES } from '@plataforma/contracts';
import { serverNow } from '@/lib/server-clock';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Avatar, Button, Dialog, IconButton, Spinner, toast } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../auth/auth-api';
import {
  activeConversation,
  type ChatMessage,
  dropLocal,
  markRead,
  useConversationDetail,
  useConversations,
  useDeleteMessage,
  useEditMessage,
  useMessages,
  useReact,
  useSendMessage,
} from './chat-api';
import { Composer, type ComposerHandle } from './Composer';
import { ConversationInfo } from './GroupInfoPanel';
import { usePresence, useTyping, useWatchPresence } from './live-stores';
import type { Mentionable } from './mentions';
import { type MessageActions, MessageList } from './MessageList';

const PRESENCE_TEXT = { online: 'disponível', away: 'ausente', offline: 'desconectado' } as const;

export function ConversationView({ conversationId }: { conversationId: string }) {
  const me = useMe().data!;
  const meId = me.user.id;
  const qc = useQueryClient();
  const detail = useConversationDetail(conversationId);
  const summary = useConversations().data?.find((c) => c.id === conversationId);
  const messages = useMessages(conversationId);
  const send = useSendMessage(conversationId, meId);
  const edit = useEditMessage();
  const del = useDeleteMessage();
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChatMessage | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const react = useReact(meId);
  const [params, setParams] = useSearchParams();
  // Mensagem a mostrar (?m=id&s=seq), vinda da busca ou das menções.
  const focusId = params.get('m');
  const focusSeq = Number(params.get('s')) || null;
  const { jumpTo } = messages;
  useEffect(() => {
    if (focusSeq) void jumpTo(focusSeq).catch(() => undefined);
  }, [focusSeq, jumpTo]);
  const clearFocus = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('m');
        next.delete('s');
        return next;
      },
      { replace: true },
    );
  const [dragging, setDragging] = useState(false);
  const composer = useRef<ComposerHandle>(null);

  const d = detail.data;
  const peer = d?.peer ?? summary?.peer ?? null;
  const presence = usePresence(peer?.id);
  useWatchPresence(peer ? [peer.id] : []);
  const typing = useTyping(conversationId).filter((u) => u !== meId);
  const items = messages.data?.items ?? [];
  const lastSeq = items.findLast((m) => !m.status)?.seq ?? 0;

  // O componente é recriado a cada conversa (key no ChatPage), então o estado local já começa limpo.
  useEffect(() => {
    activeConversation.set(conversationId);
    return () => activeConversation.set(null);
  }, [conversationId]);

  // Abriu ou chegou mensagem com a aba visível: marca como lida.
  useEffect(() => {
    if (lastSeq && document.visibilityState === 'visible') markRead(qc, conversationId, lastSeq);
  }, [qc, conversationId, lastSeq]);

  const channel = d?.channel ?? summary?.channel ?? null;
  const myRole = d?.myRole ?? summary?.myRole;
  // Canal de avisos: só administradores do canal publicam.
  const canPost = !channel || (myRole !== undefined && myRole !== 'member');
  const mentionables: Mentionable[] = (d?.members ?? [])
    .filter((m) => m.id !== meId && !m.removed)
    .map((m) => ({ id: m.id, displayName: m.displayName, avatarUrl: m.avatarUrl }));
  const allowMentionAll =
    d?.type === 'group' &&
    (d.members.length <= MESSAGE_RULES.mentionAllFreeUpTo ||
      d.myRole !== 'member' ||
      me.permissions.includes('messages.mention_all'));
  const actions: MessageActions = {
    onEdit: setEditing,
    onDelete: setConfirmDelete,
    onRetry: (m) => {
      dropLocal(qc, m);
      void send(
        m.body,
        m.attachments,
        { mentions: m.mentions, mentionAll: m.mentionsAll },
        m.clientId ?? undefined,
      );
    },
    onReact: (message, emoji, on) =>
      react.mutate({ message, emoji, on }, { onError: (e) => toast(e.message, 'error') }),
  };

  const title = d?.title ?? summary?.title ?? '';
  const typingNames = typing.map(
    (u) => d?.members.find((m) => m.id === u)?.displayName.split(' ')[0] ?? 'Alguém',
  );
  const subtitle = typingNames.length
    ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'estão' : 'está'} digitando…`
    : peer?.removed
      ? 'Conta excluída'
      : peer
        ? PRESENCE_TEXT[presence ?? 'offline']
        : channel
          ? `Canal de avisos · ${d?.memberCount ?? summary?.memberCount ?? 0} pessoas`
          : d
            ? d.members
                .map((m) => (m.id === meId ? 'Você' : m.displayName.split(' ')[0]))
                .join(', ')
            : '';

  if (detail.isError) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <Alert tone="error">{detail.error.message}</Alert>
          <Link
            to="/"
            className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Voltar para as conversas
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0">
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        aria-label={`Conversa com ${title}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          composer.current?.addFiles(e.dataTransfer.files);
        }}
      >
        <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2 md:px-4">
          <Link
            to="/"
            className="rounded-[var(--radius-control)] p-1.5 text-muted hover:bg-line/50 md:hidden"
            aria-label="Voltar para as conversas"
          >
            <ArrowLeft size={20} />
          </Link>
          <button
            type="button"
            onClick={() => setShowInfo((s) => !s)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <Avatar
              name={title || '?'}
              size={38}
              src={peer?.avatarUrl}
              group={d?.type === 'group'}
              channel={!!channel}
              presence={peer ? (presence ?? 'offline') : undefined}
            />
            <span className="min-w-0">
              <span className="block truncate font-bold">{title}</span>
              <span
                className={`block truncate text-xs ${typingNames.length ? 'font-semibold text-primary' : 'text-muted'}`}
              >
                {subtitle}
              </span>
            </span>
          </button>
          <IconButton
            label="Dados da conversa"
            onClick={() => setShowInfo((s) => !s)}
            aria-pressed={showInfo}
          >
            <Info size={19} aria-hidden="true" />
          </IconButton>
        </header>

        {messages.isPending ? (
          <div className="flex flex-1 items-center justify-center bg-chat-bg">
            <Spinner label="Carregando mensagens" />
          </div>
        ) : (
          <MessageList
            items={items}
            hasMore={messages.data?.hasMore ?? false}
            hasNewer={messages.data?.hasNewer ?? false}
            loadOlder={messages.loadOlder}
            loadNewer={messages.loadNewer}
            onJumpLatest={() => void messages.jumpToLatest()}
            focusId={focusId}
            onFocused={clearFocus}
            detail={d}
            meId={meId}
            actions={actions}
          />
        )}

        {!canPost ? (
          <p className="flex items-center justify-center gap-2 border-t border-line bg-surface px-4 py-3 text-center text-sm text-muted">
            <Megaphone size={16} aria-hidden="true" /> Canal de avisos: só os administradores
            publicam aqui. Você pode reagir às mensagens.
          </p>
        ) : peer?.removed ? (
          <p className="border-t border-line bg-surface px-4 py-3 text-center text-sm text-muted">
            Esta pessoa foi excluída do sistema. O histórico continua disponível para consulta.
          </p>
        ) : (
          <Composer
            ref={composer}
            conversationId={conversationId}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onEditLast={() => {
              const last = items.findLast(
                (m) => m.senderId === meId && m.type === 'text' && !m.deletedAt && !m.status,
              );
              if (
                last &&
                serverNow() - new Date(last.createdAt).getTime() <
                  MESSAGE_RULES.editWindowMinutes * 60_000
              )
                setEditing(last);
            }}
            onSubmitEdit={async (body, extras) => {
              await edit
                .mutateAsync({ id: editing!.id, body, ...extras })
                .catch((e: Error) => toast(e.message, 'error'));
              setEditing(null);
            }}
            onSend={async (body, attachments, extras) => {
              // Lendo no meio da conversa: volta ao fim para ver a própria mensagem.
              if (messages.data?.hasNewer) await messages.jumpToLatest();
              void send(body, attachments, extras);
            }}
            mentionables={mentionables}
            allowMentionAll={allowMentionAll}
          />
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-surface/85">
            <p className="flex items-center gap-2 text-lg font-bold text-primary">
              <Upload size={22} aria-hidden="true" /> Solte os arquivos para anexar
            </p>
          </div>
        )}
      </section>

      {showInfo && d && (
        <div className="absolute inset-0 z-30 bg-surface lg:static lg:z-auto">
          <ConversationInfo detail={d} meId={meId} onClose={() => setShowInfo(false)} />
        </div>
      )}

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        title="Apagar mensagem para todos?"
        description="Ela some para todos os participantes. O conteúdo é removido definitivamente em 48 horas."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={() =>
                del.mutate(confirmDelete!.id, {
                  onSettled: () => setConfirmDelete(null),
                  onError: (e) => toast(e.message, 'error'),
                })
              }
            >
              Apagar
            </Button>
          </>
        }
      >
        {confirmDelete?.body && (
          <p className="line-clamp-3 rounded-[var(--radius-control)] bg-paper px-3 py-2 text-sm">
            {confirmDelete.body}
          </p>
        )}
      </Dialog>
    </div>
  );
}
