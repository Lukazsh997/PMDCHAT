import type { Attachment, BroadcastRef, Message } from '@plataforma/contracts';
import type { MessageRow } from '../../database/schema/index.js';

/** Converte a linha do banco no formato enviado ao cliente; apagadas não expõem conteúdo. */
export function toMessage(
  row: MessageRow,
  attachments: Attachment[] = [],
  broadcast: BroadcastRef | null = null,
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
    attachments: deleted ? [] : attachments,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    broadcast,
  };
}
