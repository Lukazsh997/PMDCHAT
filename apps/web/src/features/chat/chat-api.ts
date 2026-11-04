import type {
  Attachment,
  ConversationDetail,
  ConversationSummary,
  DirectoryUser,
  Message,
  MessagePage,
  MessagePreview,
} from '@plataforma/contracts';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { newClientId } from '@/lib/format';
import { createStore } from '@/lib/store';

export const keys = {
  list: ['conversations'] as const,
  detail: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  directory: (q: string) => ['directory', q] as const,
};

/** Mensagem na tela: pode ainda estar sendo enviada ou ter falhado. */
export interface ChatMessage extends Message {
  status?: 'sending' | 'failed';
  /** Para reenviar uma mensagem que falhou. */
  pendingAttachmentIds?: string[];
}
export interface MessagesState {
  items: ChatMessage[];
  hasMore: boolean;
}

/** Conversa aberta agora nesta aba (para não notificar nem contar como não lida). */
export const activeConversation = createStore<string | null>(null);

export function useConversations() {
  return useQuery({
    queryKey: keys.list,
    queryFn: () => api<ConversationSummary[]>('GET', '/conversations'),
    staleTime: 30_000,
  });
}

export function useConversationDetail(id: string) {
  return useQuery({
    queryKey: keys.detail(id),
    queryFn: () => api<ConversationDetail>('GET', `/conversations/${id}`),
    staleTime: 30_000,
  });
}

export function useDirectory(q: string, enabled = true) {
  return useQuery({
    queryKey: keys.directory(q),
    queryFn: () =>
      api<DirectoryUser[]>(
        'GET',
        `/directory/users?limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useMessages(id: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.messages(id),
    queryFn: async (): Promise<MessagesState> => {
      const page = await api<MessagePage>('GET', `/conversations/${id}/messages?limit=50`);
      // Preserva o que ainda está sendo enviado nesta aba.
      const pending =
        qc.getQueryData<MessagesState>(keys.messages(id))?.items.filter((m) => m.status) ?? [];
      return { items: merge(page.items, pending), hasMore: page.hasMore };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const loadOlder = useCallback(async () => {
    const state = qc.getQueryData<MessagesState>(keys.messages(id));
    const oldest = state?.items.find((m) => !m.status);
    if (!state?.hasMore || !oldest) return;
    const page = await api<MessagePage>(
      'GET',
      `/conversations/${id}/messages?limit=50&before=${oldest.seq}`,
    );
    qc.setQueryData<MessagesState>(
      keys.messages(id),
      (s) => s && { items: merge(s.items, page.items), hasMore: page.hasMore },
    );
  }, [qc, id]);

  return { ...query, loadOlder };
}

/** Une listas de mensagens sem duplicar (por id ou clientId), ordenadas por sequência. */
export function merge(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const out = new Map<string, ChatMessage>();
  const key = (m: ChatMessage) => (m.clientId ? `c:${m.senderId}:${m.clientId}` : `i:${m.id}`);
  for (const m of [...a, ...b]) {
    const k = key(m);
    const prev = out.get(k);
    // A versão confirmada pelo servidor vence a otimista; a mais nova vence a antiga.
    if (
      !prev ||
      (prev.status && !m.status) ||
      (!m.status &&
        (m.editedAt ?? '') >= (prev.editedAt ?? '') &&
        !!m.deletedAt >= !!prev.deletedAt)
    )
      out.set(k, m);
  }
  return [...out.values()].sort(
    (x, y) =>
      (x.status ? Infinity : x.seq) - (y.status ? Infinity : y.seq) ||
      x.createdAt.localeCompare(y.createdAt),
  );
}

export function upsertMessage(qc: QueryClient, m: ChatMessage): void {
  qc.setQueryData<MessagesState>(
    keys.messages(m.conversationId),
    (s) => s && { ...s, items: merge(s.items, [m]) },
  );
}

/** Atualiza a lista de conversas quando chega uma mensagem (sem nova consulta ao servidor). */
export function applyToList(
  qc: QueryClient,
  m: Message,
  meId: string,
  preview: MessagePreview,
): boolean {
  let found = false;
  qc.setQueryData<ConversationSummary[]>(keys.list, (list) => {
    if (!list) return list;
    const idx = list.findIndex((c) => c.id === m.conversationId);
    if (idx < 0) return list;
    found = true;
    const c = list[idx]!;
    const mine = m.senderId === meId;
    const counts = m.type === 'text' && !mine && activeConversation.get() !== c.id;
    const updated: ConversationSummary = {
      ...c,
      lastSeq: Math.max(c.lastSeq, m.seq),
      lastMessage: preview,
      lastMessageAt: m.createdAt,
      unreadCount: counts ? c.unreadCount + 1 : mine ? 0 : c.unreadCount,
      lastReadSeq: mine ? m.seq : c.lastReadSeq,
    };
    return [updated, ...list.slice(0, idx), ...list.slice(idx + 1)];
  });
  return found;
}

export function previewOf(m: Message, senderName: string | null): MessagePreview {
  return {
    id: m.id,
    seq: m.seq,
    senderId: m.senderId,
    senderName,
    type: m.type,
    text: m.deletedAt
      ? ''
      : m.body || (m.attachments.length ? `📎 ${m.attachments.map((a) => a.name).join(', ')}` : ''),
    createdAt: m.createdAt,
  };
}

/** Envio otimista: a mensagem aparece na hora e é confirmada (ou marcada como falha) depois. */
export function useSendMessage(conversationId: string, meId: string) {
  const qc = useQueryClient();
  return useCallback(
    async (body: string, attachments: Attachment[] = [], clientId = newClientId()) => {
      const optimistic: ChatMessage = {
        id: `local-${clientId}`,
        conversationId,
        seq: Number.MAX_SAFE_INTEGER,
        senderId: meId,
        type: 'text',
        body,
        system: null,
        attachments,
        clientId,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        status: 'sending',
        pendingAttachmentIds: attachments.map((a) => a.id),
      };
      upsertMessage(qc, optimistic);
      try {
        const saved = await api<Message>('POST', `/conversations/${conversationId}/messages`, {
          clientId,
          body,
          attachmentIds: attachments.map((a) => a.id),
        });
        qc.setQueryData<MessagesState>(
          keys.messages(conversationId),
          (s) =>
            s && {
              ...s,
              items: merge(
                s.items.filter((x) => x.id !== optimistic.id),
                [saved],
              ),
            },
        );
        applyToList(qc, saved, meId, previewOf(saved, null));
      } catch {
        qc.setQueryData<MessagesState>(
          keys.messages(conversationId),
          (s) =>
            s && {
              ...s,
              items: s.items.map((x) =>
                x.id === optimistic.id ? { ...x, status: 'failed' as const } : x,
              ),
            },
        );
      }
    },
    [qc, conversationId, meId],
  );
}

export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: string }) =>
      api<Message>('PATCH', `/messages/${v.id}`, { body: v.body }),
    onSuccess: (m) => upsertMessage(qc, m),
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Message>('DELETE', `/messages/${id}`),
    onSuccess: (m) => upsertMessage(qc, m),
  });
}

const readTimers = new Map<string, number>();
/** Marca como lida (agrupa chamadas seguidas) e zera o contador local. */
export function markRead(qc: QueryClient, conversationId: string, seq: number): void {
  const list = qc.getQueryData<ConversationSummary[]>(keys.list);
  const c = list?.find((x) => x.id === conversationId);
  if (c && c.lastReadSeq >= seq && c.unreadCount === 0) return;
  qc.setQueryData<ConversationSummary[]>(keys.list, (l) =>
    l?.map((x) =>
      x.id === conversationId
        ? { ...x, unreadCount: 0, lastReadSeq: Math.max(x.lastReadSeq, seq) }
        : x,
    ),
  );
  window.clearTimeout(readTimers.get(conversationId));
  readTimers.set(
    conversationId,
    window.setTimeout(
      () =>
        void api('POST', `/conversations/${conversationId}/read`, { seq }).catch(() => undefined),
      400,
    ),
  );
}

export function useOpenDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<ConversationSummary>('POST', '/conversations/direct', { userId }),
    onSuccess: (c) => upsertSummary(qc, c),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; description?: string; memberIds: string[] }) =>
      api<ConversationSummary>('POST', '/conversations/group', v),
    onSuccess: (c) => upsertSummary(qc, c),
  });
}

export function upsertSummary(qc: QueryClient, c: ConversationSummary): void {
  qc.setQueryData<ConversationSummary[]>(keys.list, (list) => {
    if (!list) return list;
    const rest = list.filter((x) => x.id !== c.id);
    const updated = activeConversation.get() === c.id ? { ...c, unreadCount: 0 } : c;
    return [updated, ...rest].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  });
}

/** Operações do grupo; todas atualizam o detalhe com a resposta do servidor. */
export function useGroupActions(id: string) {
  const qc = useQueryClient();
  const done = (d: ConversationDetail) => {
    qc.setQueryData(keys.detail(id), d);
    upsertSummary(qc, d);
  };
  return {
    rename: useMutation({
      mutationFn: (v: { name?: string; description?: string | null }) =>
        api<ConversationDetail>('PATCH', `/conversations/${id}`, v),
      onSuccess: done,
    }),
    add: useMutation({
      mutationFn: (userIds: string[]) =>
        api<ConversationDetail>('POST', `/conversations/${id}/members`, { userIds }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => api<void>('DELETE', `/conversations/${id}/members/${userId}`),
      onSuccess: () => void qc.invalidateQueries({ queryKey: keys.detail(id) }),
    }),
    setRole: useMutation({
      mutationFn: (v: { userId: string; role: 'admin' | 'member' }) =>
        api<ConversationDetail>('PUT', `/conversations/${id}/members/${v.userId}/role`, {
          role: v.role,
        }),
      onSuccess: done,
    }),
    mute: useMutation({
      mutationFn: (mutedUntil: string | null) =>
        api<ConversationSummary>('PATCH', `/conversations/${id}/me`, { mutedUntil }),
      onSuccess: (c) => {
        upsertSummary(qc, c);
        void qc.invalidateQueries({ queryKey: keys.detail(id) });
      },
    }),
  };
}

export const isMuted = (c: Pick<ConversationSummary, 'mutedUntil'>) =>
  !!c.mutedUntil && new Date(c.mutedUntil) > new Date();
