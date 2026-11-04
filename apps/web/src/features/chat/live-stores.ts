import type { PresenceStatus } from '@plataforma/contracts';
import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { createStore } from '@/lib/store';

/** Presença das pessoas que aparecem na tela. */
export const presenceStore = createStore<Record<string, PresenceStatus>>({});

export function usePresence(userId: string | null | undefined): PresenceStatus | undefined {
  return presenceStore.use((s) => (userId ? s[userId] : undefined));
}

/** Pede ao servidor para acompanhar a presença destas pessoas. */
export function useWatchPresence(userIds: string[]): void {
  const key = [...new Set(userIds)].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    const socket = getSocket();
    const watch = () =>
      socket.emit('presence.watch', { userIds: ids }, (statuses) =>
        presenceStore.set((s) => ({ ...s, ...statuses })),
      );
    watch();
    socket.on('connect', watch);
    return () => void socket.off('connect', watch);
  }, [key]);
}

/** Quem está digitando, por conversa (expira em 6 s sem novo sinal). */
export const typingStore = createStore<Record<string, Record<string, number>>>({});

export function markTyping(conversationId: string, userId: string): void {
  typingStore.set((s) => ({
    ...s,
    [conversationId]: { ...s[conversationId], [userId]: Date.now() },
  }));
  setTimeout(() => typingStore.set((s) => ({ ...s })), 6100);
}

export function clearTyping(conversationId: string, userId: string): void {
  typingStore.set((s) => {
    if (!s[conversationId]?.[userId]) return s;
    const { [userId]: _, ...rest } = s[conversationId];
    return { ...s, [conversationId]: rest };
  });
}

export function useTyping(conversationId: string): string[] {
  const map = typingStore.use((s) => s[conversationId]);
  const now = Date.now();
  return Object.entries(map ?? {})
    .filter(([, t]) => now - t < 6000)
    .map(([u]) => u);
}

let lastTypingSent = 0;
/** Avisa que estou digitando, no máximo a cada 3 s. */
export function sendTyping(conversationId: string): void {
  if (Date.now() - lastTypingSent < 3000) return;
  lastTypingSent = Date.now();
  getSocket().emit('typing', { conversationId });
}
