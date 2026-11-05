import { Inject, Injectable } from '@nestjs/common';
import {
  type Attachment,
  type BroadcastRef,
  type MentionPage,
  type Message,
  MESSAGE_RULES,
  type MessagePage,
  type Reaction,
  type ThreadPage,
} from '@plataforma/contracts';
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
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
  messageMentions,
  messageReactions,
  type MessageRow,
  messages,
  users,
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
    q: { before?: number; after?: number; around?: number; limit: number },
  ): Promise<MessagePage> {
    const { member } = await this.conversations.requireMember(userId, conversationId);
    const base = [
      eq(messages.conversationId, conversationId),
      gt(messages.seq, member.joinedSeq),
      // Respostas de thread ficam no painel da thread, não na linha do tempo.
      isNull(messages.threadRootId),
    ];
    let rows: MessageRow[];
    if (q.around !== undefined) {
      // Abre a conversa no meio: metade antes da mensagem procurada, metade a partir dela.
      const half = Math.ceil(q.limit / 2);
      const [older, newer] = await Promise.all([
        this.db
          .select()
          .from(messages)
          .where(and(...base, lt(messages.seq, q.around)))
          .orderBy(desc(messages.seq))
          .limit(half + 1),
        this.db
          .select()
          .from(messages)
          .where(and(...base, gte(messages.seq, q.around)))
          .orderBy(asc(messages.seq))
          .limit(half + 1),
      ]);
      return {
        items: await this.withAttachments([
          ...older.slice(0, half).reverse(),
          ...newer.slice(0, half),
        ]),
        hasMore: older.length > half,
        hasNewer: newer.length > half,
      };
    }
    if (q.after !== undefined) {
      rows = await this.db
        .select()
        .from(messages)
        .where(and(...base, gt(messages.seq, q.after)))
        .orderBy(asc(messages.seq))
        .limit(q.limit + 1);
      // Aqui "hasMore" fala das mais novas, na direção pedida.
      const hasMore = rows.length > q.limit;
      return {
        items: await this.withAttachments(rows.slice(0, q.limit)),
        hasMore,
        hasNewer: hasMore,
      };
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
    input: {
      clientId: string;
      body: string;
      attachmentIds: string[];
      threadRootId?: string;
      mentions: string[];
      mentionAll: boolean;
    },
    grants: Grants,
  ): Promise<Message> {
    const { member } = await this.conversations.requireMember(auth.user.id, conversationId);
    const existing = await this.findByClientId(conversationId, auth.user.id, input.clientId);
    if (existing) return existing;

    if (input.threadRootId) {
      const [root] = await this.db
        .select()
        .from(messages)
        .where(eq(messages.id, input.threadRootId))
        .limit(1);
      if (
        !root ||
        root.conversationId !== conversationId ||
        root.seq <= member.joinedSeq ||
        root.type !== 'text' ||
        root.threadRootId
      ) {
        throw new AppException(404, 'NOT_FOUND', 'A mensagem que abriu esta thread não existe.');
      }
      if (root.deletedAt)
        throw new AppException(409, 'CONFLICT', 'A mensagem que abriu esta thread foi apagada.');
    }
    const mentions = await this.resolveMentions(auth, conversationId, input, grants);

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
          threadRootId: input.threadRootId ?? null,
          mentionsAll: mentions.all,
        })
        .returning();
      if (mentions.userIds.length) {
        await tx
          .insert(messageMentions)
          .values(mentions.userIds.map((userId) => ({ messageId: msg!.id, userId })));
      }
      if (input.threadRootId) {
        await tx
          .update(messages)
          .set({ replyCount: sql`${messages.replyCount} + 1`, lastReplyAt: new Date() })
          .where(eq(messages.id, input.threadRootId));
      }
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
    const recipientIds = await this.conversations.memberIds(conversationId);
    this.events.emit('message.created', { message: message!, recipientIds });
    if (input.threadRootId) await this.publishUpdate(await this.row(input.threadRootId));
    return message!;
  }

  /** Thread: a mensagem raiz e todas as respostas, em ordem. */
  async thread(userId: string, rootId: string): Promise<ThreadPage> {
    const root = await this.load(userId, rootId);
    if (root.threadRootId) return this.thread(userId, root.threadRootId);
    const replies = await this.db
      .select()
      .from(messages)
      .where(eq(messages.threadRootId, rootId))
      .orderBy(asc(messages.seq))
      .limit(1000);
    const [r, ...rest] = await this.withAttachments([root, ...replies]);
    return { root: r!, replies: rest };
  }

  /** Liga ou desliga a minha reação com este emoji. */
  async react(auth: AuthContext, messageId: string, emoji: string, on: boolean): Promise<Message> {
    const row = await this.load(auth.user.id, messageId);
    if (row.type !== 'text' || row.deletedAt)
      throw new AppException(409, 'CONFLICT', 'Não é possível reagir a esta mensagem.');
    if (on) {
      await this.db
        .insert(messageReactions)
        .values({ messageId, userId: auth.user.id, emoji })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.userId, auth.user.id),
            eq(messageReactions.emoji, emoji),
          ),
        );
    }
    return this.publishUpdate(row);
  }

  /**
   * Aba Menções: mensagens que me citam (ou @todos) nas conversas em que estou,
   * da mais recente para a mais antiga.
   */
  async mentions(userId: string, q: { before?: string; limit: number }): Promise<MentionPage> {
    const rows = (await this.db.execute(sql`
      select m.id, c.id as conversation_id, c.type, c.name,
             (m.seq > greatest(cm.last_read_seq, cm.joined_seq)) as unread
        from messages m
        join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId}
        join conversations c on c.id = m.conversation_id
       where m.seq > cm.joined_seq and m.deleted_at is null and m.type = 'text'
         and m.sender_id is distinct from ${userId}
         and (m.mentions_all or exists (
               select 1 from message_mentions mm where mm.message_id = m.id and mm.user_id = ${userId}))
         ${q.before ? sql`and m.created_at < ${new Date(q.before).toISOString()}::timestamptz` : sql``}
       order by m.created_at desc
       limit ${q.limit + 1}
    `)) as unknown as {
      id: string;
      conversation_id: string;
      type: 'direct' | 'group';
      name: string | null;
      unread: boolean;
    }[];
    const page = rows.slice(0, q.limit);
    const full = page.length
      ? await this.db
          .select()
          .from(messages)
          .where(
            inArray(
              messages.id,
              page.map((r) => r.id),
            ),
          )
      : [];
    const byId = new Map((await this.withAttachments(full)).map((m) => [m.id, m]));
    const senders = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, [...new Set(full.map((m) => m.senderId!).filter(Boolean))]));
    const nameOf = new Map(senders.map((u) => [u.id, u.name]));
    return {
      items: page.map((r) => {
        const message = byId.get(r.id)!;
        return {
          message,
          senderName: nameOf.get(message.senderId ?? '') ?? 'Alguém',
          conversation: {
            id: r.conversation_id,
            type: r.type,
            title:
              r.type === 'direct'
                ? (nameOf.get(message.senderId ?? '') ?? 'Conversa')
                : (r.name ?? 'Grupo'),
          },
          unread: r.unread,
        };
      }),
      hasMore: rows.length > q.limit,
    };
  }

  /**
   * Menções válidas: só membros da conversa, e só quem aparece como "@Nome" no texto
   * (apagar o nome do texto tira a menção). @todos vale em grupos; em grupos grandes
   * exige ser administrador do grupo ou ter a permissão `messages.mention_all`.
   */
  private async resolveMentions(
    auth: AuthContext,
    conversationId: string,
    input: { body: string; mentions: string[]; mentionAll: boolean },
    grants: Grants,
  ): Promise<{ userIds: string[]; all: boolean }> {
    const body = input.body.toLocaleLowerCase('pt-BR');
    let all = false;
    if (input.mentionAll && body.includes('@todos')) {
      const { conversation, member } = await this.conversations.requireMember(
        auth.user.id,
        conversationId,
      );
      if (conversation.type === 'group') {
        const [n] = await this.db
          .select({ n: count() })
          .from(conversationMembers)
          .where(eq(conversationMembers.conversationId, conversationId));
        const allowed =
          (n?.n ?? 0) <= MESSAGE_RULES.mentionAllFreeUpTo ||
          member.role !== 'member' ||
          grants.hasAny('messages.mention_all');
        if (!allowed) {
          throw new AppException(
            403,
            'FORBIDDEN',
            `Em grupos com mais de ${MESSAGE_RULES.mentionAllFreeUpTo} pessoas, só administradores do grupo usam @todos.`,
          );
        }
        all = true;
      }
    }
    const ids = [...new Set(input.mentions)].filter((id) => id !== auth.user.id);
    if (!ids.length) return { userIds: [], all };
    const rows = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          inArray(conversationMembers.userId, ids),
        ),
      );
    return {
      userIds: rows
        .filter((r) => body.includes(`@${r.name.toLocaleLowerCase('pt-BR')}`))
        .map((r) => r.id),
      all,
    };
  }

  private async row(id: string): Promise<MessageRow> {
    const [r] = await this.db.select().from(messages).where(eq(messages.id, id)).limit(1);
    return r!;
  }

  async edit(
    auth: AuthContext,
    messageId: string,
    input: { body: string; mentions: string[]; mentionAll: boolean },
    grants: Grants,
  ): Promise<Message> {
    const { body } = input;
    const row = await this.load(auth.user.id, messageId);
    this.assertAuthor(auth, row, 'editar');
    if (row.deletedAt) throw new AppException(409, 'CONFLICT', 'Esta mensagem foi apagada.');
    if (body === row.body) {
      await this.assertWithinWindow(messageId, MESSAGE_RULES.editWindowMinutes, 'editadas');
      return (await this.withAttachments([row]))[0]!;
    }

    const mentions = await this.resolveMentions(auth, row.conversationId, input, grants);
    const updated = await this.db.transaction(async (tx) => {
      // O prazo é conferido na própria atualização, pelo relógio do banco que gravou o envio:
      // o horário do computador de quem edita não conta, e não há corrida com o prazo.
      const [u] = await tx
        .update(messages)
        .set({ body, editedAt: new Date() })
        .where(and(eq(messages.id, messageId), withinMinutes(MESSAGE_RULES.editWindowMinutes)))
        .returning();
      if (!u) throw windowClosed(MESSAGE_RULES.editWindowMinutes, 'editadas');
      await tx
        .insert(messageEdits)
        .values({ messageId, previousBody: row.body, editedBy: auth.user.id });
      // Menções recalculadas pelo texto novo.
      await tx.delete(messageMentions).where(eq(messageMentions.messageId, messageId));
      if (mentions.userIds.length) {
        await tx
          .insert(messageMentions)
          .values(mentions.userIds.map((userId) => ({ messageId, userId })));
      }
      if (u.mentionsAll !== mentions.all) {
        const [m] = await tx
          .update(messages)
          .set({ mentionsAll: mentions.all })
          .where(eq(messages.id, messageId))
          .returning();
        return m!;
      }
      return u;
    });
    return this.publishUpdate(updated);
  }

  /**
   * Apaga uma mensagem: some para todos na hora e o conteúdo é removido em definitivo
   * após 48 h (tarefa do worker). Só quem enviou, e só dentro do prazo.
   */
  async remove(auth: AuthContext, messageId: string): Promise<Message> {
    const row = await this.load(auth.user.id, messageId);
    if (row.type !== 'text') throw forbidden('Mensagens do sistema não podem ser apagadas.');
    this.assertAuthor(auth, row, 'apagar');
    if (row.deletedAt) return (await this.withAttachments([row]))[0]!;

    const [updated] = await this.db
      .update(messages)
      .set({ deletedAt: new Date(), deletedBy: auth.user.id })
      .where(
        and(
          eq(messages.id, messageId),
          isNull(messages.deletedAt),
          withinMinutes(MESSAGE_RULES.deleteWindowMinutes),
        ),
      )
      .returning();
    if (!updated) throw windowClosed(MESSAGE_RULES.deleteWindowMinutes, 'apagadas');
    await this.audit.record({
      action: 'message.deleted',
      actorId: auth.user.id,
      entityType: 'message',
      entityId: messageId,
      metadata: { conversationId: row.conversationId },
    });
    return this.publishUpdate(updated);
  }

  private assertAuthor(auth: AuthContext, row: MessageRow, verb: string): void {
    if (row.senderId !== auth.user.id || row.type !== 'text')
      throw forbidden(`Você só pode ${verb} as suas mensagens.`);
  }

  private async assertWithinWindow(messageId: string, minutes: number, what: string) {
    const [ok] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, messageId), withinMinutes(minutes)))
      .limit(1);
    if (!ok) throw windowClosed(minutes, what);
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
          label: broadcasts.label,
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
    const reactions = new Map<string, Reaction[]>();
    const mentioned = new Map<string, string[]>();
    if (ids.length) {
      const [rx, mx] = await Promise.all([
        this.db
          .select()
          .from(messageReactions)
          .where(inArray(messageReactions.messageId, ids))
          .orderBy(asc(messageReactions.createdAt)),
        this.db.select().from(messageMentions).where(inArray(messageMentions.messageId, ids)),
      ]);
      for (const r of rx) {
        const list = reactions.get(r.messageId) ?? [];
        const entry = list.find((e) => e.emoji === r.emoji);
        if (entry) entry.userIds.push(r.userId);
        else list.push({ emoji: r.emoji, userIds: [r.userId] });
        reactions.set(r.messageId, list);
      }
      for (const m of mx)
        mentioned.set(m.messageId, [...(mentioned.get(m.messageId) ?? []), m.userId]);
    }
    return rows.map((r) =>
      toMessage(r, {
        attachments: byMessage.get(r.id),
        broadcast: r.broadcastId ? (refs.get(r.broadcastId) ?? null) : null,
        reactions: reactions.get(r.id),
        mentions: mentioned.get(r.id),
      }),
    );
  }
}

const forbidden = (message: string) => new AppException(403, 'FORBIDDEN', message);

/** Enviada há menos de `minutes` minutos, pelo relógio do banco (o mesmo que gravou o envio). */
const withinMinutes = (minutes: number) =>
  sql`${messages.createdAt} > now() - make_interval(mins => ${minutes}::int)`;

const windowClosed = (minutes: number, what: string) =>
  new AppException(
    409,
    'CONFLICT',
    `Mensagens só podem ser ${what} até ${minutes} minutos após o envio.`,
  );
