import type { ConversationSummary, Message } from '@plataforma/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { setUnreadBadge, showNotification } from '@/lib/notifications';
import { closeSocket, getSocket } from '@/lib/socket';
import { meKey } from '../auth/auth-api';
import {
  activeConversation,
  applyToList,
  isMuted,
  keys,
  markRead,
  type MessagesState,
  previewOf,
  upsertMessage,
  upsertSummary,
} from './chat-api';
import { clearTyping, markTyping, presenceStore } from './live-stores';
import { systemText } from './system-text';

/**
 * Liga a conexão em tempo real aos dados da tela. Montado uma vez no AppShell.
 * Também cuida das notificações do Chrome e do contador de não lidas na aba.
 */
export function useRealtimeSync(meId: string | undefined) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!meId) return;
    const socket = getSocket();

    const nameOf = (conversationId: string, userId: string | null) => {
      if (!userId) return null;
      const detail = qc.getQueryData<{ members: { id: string; displayName: string }[] }>(
        keys.detail(conversationId),
      );
      const fromDetail = detail?.members.find((m) => m.id === userId)?.displayName;
      if (fromDetail) return fromDetail;
      const list = qc.getQueryData<ConversationSummary[]>(keys.list);
      return list?.find((c) => c.peer?.id === userId)?.peer?.displayName ?? null;
    };

    const onMessage = (m: Message) => {
      upsertMessage(qc, m);
      if (m.senderId) clearTyping(m.conversationId, m.senderId);
      const senderName = nameOf(m.conversationId, m.senderId);
      if (!applyToList(qc, m, meId, previewOf(m, senderName))) {
        // Conversa nova para mim (ex.: alguém me mandou a primeira mensagem).
        void qc.invalidateQueries({ queryKey: keys.list });
      }
      if (m.type === 'system')
        void qc.invalidateQueries({ queryKey: keys.detail(m.conversationId) });

      const viewing =
        activeConversation.get() === m.conversationId && document.visibilityState === 'visible';
      if (viewing && m.senderId !== meId) markRead(qc, m.conversationId, m.seq);
      if (m.senderId === meId || m.type !== 'text' || viewing) return;

      const summary = qc
        .getQueryData<ConversationSummary[]>(keys.list)
        ?.find((c) => c.id === m.conversationId);
      if (summary && isMuted(summary)) return;
      const who = senderName ?? 'Nova mensagem';
      showNotification({
        title: m.broadcast
          ? `Comunicado${senderName ? ` de ${senderName}` : ''} para ${m.broadcast.label}`
          : summary?.type === 'group'
            ? `${who} em ${summary.title}`
            : who,
        body: m.body || (m.attachments.length ? `📎 ${m.attachments[0]!.name}` : ''),
        tag: m.conversationId,
        onClick: () => void navigate(`/c/${m.conversationId}`),
      });
    };

    const onUpdated = (m: Message) => upsertMessage(qc, m);
    const onConversation = (c: ConversationSummary) => {
      upsertSummary(qc, c);
      void qc.invalidateQueries({ queryKey: keys.detail(c.id) });
    };
    const onRemoved = ({ conversationId }: { conversationId: string }) => {
      qc.setQueryData<ConversationSummary[]>(keys.list, (l) =>
        l?.filter((c) => c.id !== conversationId),
      );
      qc.removeQueries({ queryKey: keys.messages(conversationId) });
      qc.removeQueries({ queryKey: keys.detail(conversationId) });
      if (activeConversation.get() === conversationId) void navigate('/');
    };
    const onRead = (p: { conversationId: string; userId: string; seq: number }) => {
      if (p.userId === meId) {
        qc.setQueryData<ConversationSummary[]>(keys.list, (l) =>
          l?.map((c) =>
            c.id === p.conversationId
              ? { ...c, unreadCount: 0, lastReadSeq: Math.max(c.lastReadSeq, p.seq) }
              : c,
          ),
        );
        return;
      }
      qc.setQueryData<{ members: { id: string; lastReadSeq: number }[] }>(
        keys.detail(p.conversationId),
        (d) =>
          d && {
            ...d,
            members: d.members.map((mm) =>
              mm.id === p.userId ? { ...mm, lastReadSeq: Math.max(mm.lastReadSeq, p.seq) } : mm,
            ),
          },
      );
    };
    const onTyping = (p: { conversationId: string; userId: string }) =>
      markTyping(p.conversationId, p.userId);
    const onPresence = (p: { userId: string; status: 'online' | 'away' | 'offline' }) =>
      presenceStore.set((s) => ({ ...s, [p.userId]: p.status }));
    const onRevoked = () => {
      closeSocket();
      qc.setQueryData(meKey, null);
    };
    // Depois de uma queda de conexão, busca o que pode ter chegado nesse intervalo.
    let connectedOnce = false;
    const onConnect = () => {
      if (connectedOnce) {
        void qc.invalidateQueries({ queryKey: keys.list });
        void qc.invalidateQueries({ queryKey: ['messages'] });
      }
      connectedOnce = true;
    };

    socket.on('message.new', onMessage);
    socket.on('message.updated', onUpdated);
    socket.on('conversation.updated', onConversation);
    socket.on('conversation.removed', onRemoved);
    socket.on('read.updated', onRead);
    socket.on('typing', onTyping);
    socket.on('presence.changed', onPresence);
    socket.on('session.revoked', onRevoked);
    socket.on('connect', onConnect);
    if (socket.connected) connectedOnce = true;

    // Ausente após 5 min sem usar o computador ou com a aba escondida.
    let idleTimer = 0;
    let away = false;
    const setAway = (v: boolean) => {
      if (v === away) return;
      away = v;
      socket.emit('presence.set', { status: v ? 'away' : 'online' });
    };
    const activity = () => {
      setAway(false);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setAway(true), 5 * 60_000);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') {
        activity();
        const id = activeConversation.get();
        const last =
          id && qc.getQueryData<MessagesState>(keys.messages(id))?.items.findLast((x) => !x.status);
        if (id && last) markRead(qc, id, last.seq);
      }
    };
    const events = ['mousemove', 'keydown', 'pointerdown'] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener('visibilitychange', visibility);
    activity();

    return () => {
      socket.off('message.new', onMessage);
      socket.off('message.updated', onUpdated);
      socket.off('conversation.updated', onConversation);
      socket.off('conversation.removed', onRemoved);
      socket.off('read.updated', onRead);
      socket.off('typing', onTyping);
      socket.off('presence.changed', onPresence);
      socket.off('session.revoked', onRevoked);
      socket.off('connect', onConnect);
      events.forEach((e) => window.removeEventListener(e, activity));
      document.removeEventListener('visibilitychange', visibility);
      window.clearTimeout(idleTimer);
    };
  }, [qc, meId, navigate]);

  // Contador de não lidas no título e no ícone da aba.
  useEffect(() => {
    const update = () => {
      const list = qc.getQueryData<ConversationSummary[]>(keys.list) ?? [];
      setUnreadBadge(list.filter((c) => !isMuted(c)).reduce((n, c) => n + c.unreadCount, 0));
    };
    update();
    return qc.getQueryCache().subscribe((e) => {
      if (e.query.queryKey[0] === keys.list[0]) update();
    });
  }, [qc]);
}

export { systemText };
