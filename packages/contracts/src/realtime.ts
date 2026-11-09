import type { ConversationSummary, Message } from './conversations.js';

export type PresenceStatus = 'online' | 'away' | 'offline';

/** Eventos enviados pelo servidor ao navegador. */
export interface ServerToClientEvents {
  'message.new': (m: Message) => void;
  'message.updated': (m: Message) => void;
  'conversation.updated': (c: ConversationSummary) => void;
  'conversation.removed': (p: { conversationId: string }) => void;
  'read.updated': (p: { conversationId: string; userId: string; seq: number }) => void;
  typing: (p: { conversationId: string; userId: string }) => void;
  'presence.changed': (p: { userId: string; status: PresenceStatus }) => void;
  'session.revoked': () => void;
}

/** Eventos enviados pelo navegador ao servidor. */
export interface ClientToServerEvents {
  typing: (p: { conversationId: string }) => void;
  'presence.set': (p: { status: 'online' | 'away' }) => void;
  'presence.watch': (
    p: { userIds: string[] },
    ack: (r: Record<string, PresenceStatus>) => void,
  ) => void;
}

export const REALTIME_PATH = '/socket.io';
