import type { Attachment, BroadcastRef, Message, Reaction } from '@plataforma/contracts';
import type { MessageRow } from '../../database/schema/index.js';

/** Converte a linha do banco no formato enviado ao cliente; apagadas não expõem conteúdo. */
export function toMessage(
  row: MessageRow,
  extra: {
    attachments?: Attachment[];
    broadcast?: BroadcastRef | null;
    reactions?: Reaction[];
    mentions?: string[];
  } = {},
): Message {
  const deleted = !!row.deletedAt;
  return {
    id: row.id,
    conversationId: row.conversationId,
    seq: row.seq,
    senderId: row.senderId,
    type: row.type,
    body: deleted ? '' : row.body,
    system: row.system ?? null,
    attachments: deleted ? [] : (extra.attachments ?? []),
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    broadcast: extra.broadcast ?? null,
    threadRootId: row.threadRootId,
    replyCount: row.replyCount,
    lastReplyAt: row.lastReplyAt?.toISOString() ?? null,
    reactions: deleted ? [] : (extra.reactions ?? []),
    mentions: deleted ? [] : (extra.mentions ?? []),
    mentionsAll: !deleted && row.mentionsAll,
  };
}
