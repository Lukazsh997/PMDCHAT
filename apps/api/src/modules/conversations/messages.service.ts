import { Inject, Injectable } from '@nestjs/common';
import {
  type Attachment,
  type BroadcastRef,
  type Message,
  MESSAGE_RULES,
  type MessagePage,
} from '@plataforma/contracts';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import {
  broadcasts,
  conversationMembers,
  conversations,
  files,
  messageAttachments,
  messageEdits,
  type MessageRow,
  messages,
} from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import type { AuthContext } from '../auth/index.js';
import { toUploaded } from '../files/index.js';
import type { Grants } from '../rbac/index.js';
import { ConversationsService } from './conversations.service.js';
import { toMessage } from './message-mapper.js';

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly conversations: ConversationsService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  /** Página de mensagens em ordem crescente. Sem cursor: as mais recentes. */
  async list(
    userId: string,
    conversationId: string,
    q: { before?: number; after?: number; limit: number },
  ): Promise<MessagePage> {
    const { member } = await this.conversations.requireMember(userId, conversationId);
    const base = [eq(messages.conversationId, conversationId), gt(messages.seq, member.joinedSeq)];
    let rows: MessageRow[];
    if (q.after !== undefined) {
      rows = await this.db
        .select()
        .from(messages)
        .where(and(...base, gt(messages.seq, q.after)))
        .orderBy(asc(messages.seq))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      return { items: await this.withAttachments(rows.slice(0, q.limit)), hasMore };
    }
    rows = await this.db
      .select()
      .from(messages)
      .where(and(...base, ...(q.before !== undefined ? [lt(messages.seq, q.before)] : [])))
      .orderBy(desc(messages.seq))
      .limit(q.limit + 1);
    const hasMore = rows.length > q.limit;
    return { items: await this.withAttachments(rows.slice(0, q.limit).reverse()), hasMore };
  }

  /**
   * Envia uma mensagem. Idempotente por `clientId`: se a rede cair e o navegador
   * reenviar, a mesma mensagem é devolvida, sem duplicar.
   */
  async send(
    auth: AuthContext,
    conversationId: string,
    input: { clientId: string; body: string; attachmentIds: string[] },
  ): Promise<Message> {
    await this.conversations.requireMember(auth.user.id, conversationId);
    const existing = await this.findByClientId(conversationId, auth.user.id, input.clientId);
    if (existing) return existing;

    const row = await this.db.transaction(async (tx) => {
      if (input.attachmentIds.length) {
        const owned = await tx
          .update(files)
          .set({ attachedAt: new Date() })
          .where(
            and(
              inArray(files.id, input.attachmentIds),
              eq(files.uploaderId, auth.user.id),
              isNull(files.attachedAt),
            ),
          )
          .returning({ id: files.id });
        if (owned.length !== new Set(input.attachmentIds).size) {
          throw new AppException(
            400,
            'VALIDATION_FAILED',
            'Um dos anexos não está disponível. Envie o arquivo de novo.',
          );
        }
      }
      // A atualização trava a linha da conversa: os números de sequência saem em ordem.
      const [conv] = await tx
        .update(conversations)
        .set({ lastSeq: sql`${conversations.lastSeq} + 1`, lastMessageAt: new Date() })
        .where(eq(conversations.id, conversationId))
        .returning({ lastSeq: conversations.lastSeq });
      const [msg] = await tx
        .insert(messages)
        .values({
          conversationId,
          seq: conv!.lastSeq,
          senderId: auth.user.id,
          body: input.body,
          clientId: input.clientId,
        })
        .returning();
      if (input.attachmentIds.length) {
        await tx.insert(messageAttachments).values(
          input.attachmentIds.map((fileId, position) => ({
            messageId: msg!.id,
            fileId,
            position,
          })),
        );
      }
      await tx
        .update(conversationMembers)
        .set({ lastReadSeq: conv!.lastSeq })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, auth.user.id),
          ),
        );
      return msg!;
    });

    const [message] = await this.withAttachments([row]);
    this.events.emit('message.created', {
      message: message!,
      recipientIds: await this.conversations.memberIds(conversationId),
    });
    return message!;
  }

  async edit(auth: AuthContext, messageId: string, body: string): Promise<Message> {
    const row = await this.load(auth.user.id, messageId);
    if (row.senderId !== auth.user.id || row.type !== 'text')
      throw forbidden('Você só pode editar as suas mensagens.');
    if (row.deletedAt) throw new AppException(409, 'CONFLICT', 'Esta mensagem foi apagada.');
    const minutes = (Date.now() - row.createdAt.getTime()) / 60_000;
    if (minutes > MESSAGE_RULES.editWindowMinutes) {
      throw new AppException(
        409,
        'CONFLICT',
        `Mensagens só podem ser editadas até ${MESSAGE_RULES.editWindowMinutes} minutos após o envio.`,
      );
    }
    if (body === row.body) return (await this.withAttachments([row]))[0]!;

    const updated = await this.db.transaction(async (tx) => {
      await tx
        .insert(messageEdits)
        .values({ messageId, previousBody: row.body, editedBy: auth.user.id });
      const [u] = await tx
        .update(messages)
        .set({ body, editedAt: new Date() })
        .where(eq(messages.id, messageId))
        .returning();
      return u!;
    });
    return this.publishUpdate(updated);
  }

  /**
   * Apaga uma mensagem: some para todos na hora e o conteúdo é removido em
   * definitivo após 48 h (tarefa do worker).
   */
  async remove(auth: AuthContext, grants: Grants, messageId: string): Promise<Message> {
    const row = await this.load(auth.user.id, messageId);
    if (row.type !== 'text') throw forbidden('Mensagens do sistema não podem ser apagadas.');
    if (row.deletedAt) return (await this.withAttachments([row]))[0]!;

    const own = row.senderId === auth.user.id;
    let reason: 'own' | 'group_admin' | 'moderator' = 'own';
    if (!own) {
      const { member, conversation } = await this.conversations.requireMember(
        auth.user.id,
        row.conversationId,
      );
      if (conversation.type === 'group' && member.role !== 'member') reason = 'group_admin';
      else if (grants.hasGlobal('messages.delete_any')) reason = 'moderator';
      else throw forbidden('Você só pode apagar as suas mensagens.');
    }
    const [updated] = await this.db
      .update(messages)
      .set({ deletedAt: new Date(), deletedBy: auth.user.id })
      .where(eq(messages.id, messageId))
      .returning();
    await this.audit.record({
      action: own ? 'message.deleted' : 'message.deleted_by_moderator',
      actorId: auth.user.id,
      entityType: 'message',
      entityId: messageId,
      metadata: { conversationId: row.conversationId, senderId: row.senderId, reason },
    });
    return this.publishUpdate(updated!);
  }

  private async publishUpdate(row: MessageRow): Promise<Message> {
    const [message] = await this.withAttachments([row]);
    this.events.emit('message.updated', {
      message: message!,
      recipientIds: await this.conversations.memberIds(row.conversationId),
    });
    return message!;
  }

  private async load(userId: string, messageId: string): Promise<MessageRow> {
    const [row] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!row) throw new AppException(404, 'NOT_FOUND', 'Mensagem não encontrada');
    const { member } = await this.conversations.requireMember(userId, row.conversationId);
    if (row.seq <= member.joinedSeq)
      throw new AppException(404, 'NOT_FOUND', 'Mensagem não encontrada');
    return row;
  }

  private async findByClientId(
    conversationId: string,
    senderId: string,
    clientId: string,
  ): Promise<Message | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.senderId, senderId),
          eq(messages.clientId, clientId),
        ),
      )
      .limit(1);
    return row ? (await this.withAttachments([row]))[0]! : null;
  }

  async withAttachments(rows: MessageRow[]): Promise<Message[]> {
    const ids = rows.filter((r) => !r.deletedAt).map((r) => r.id);
    const byMessage = new Map<string, Attachment[]>();
    const broadcastIds = [...new Set(rows.flatMap((r) => (r.broadcastId ? [r.broadcastId] : [])))];
    const refs = new Map<string, BroadcastRef>();
    if (broadcastIds.length) {
      const b = await this.db
        .select({
          id: broadcasts.id,
          unitName: broadcasts.unitName,
          includeSubunits: broadcasts.includeSubunits,
        })
        .from(broadcasts)
        .where(inArray(broadcasts.id, broadcastIds));
      for (const r of b) refs.set(r.id, r);
    }
    if (ids.length) {
      const att = await this.db
        .select({ messageId: messageAttachments.messageId, file: files })
        .from(messageAttachments)
        .innerJoin(files, eq(files.id, messageAttachments.fileId))
        .where(inArray(messageAttachments.messageId, ids))
        .orderBy(asc(messageAttachments.position));
      for (const a of att)
        byMessage.set(a.messageId, [...(byMessage.get(a.messageId) ?? []), toUploaded(a.file)]);
    }
    return rows.map((r) =>
      toMessage(r, byMessage.get(r.id), r.broadcastId ? (refs.get(r.broadcastId) ?? null) : null),
    );
  }
}

const forbidden = (message: string) => new AppException(403, 'FORBIDDEN', message);
