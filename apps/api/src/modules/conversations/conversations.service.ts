import { Inject, Injectable } from '@nestjs/common';
import type {
  ConversationDetail,
  ConversationMember,
  ConversationSummary,
  MemberRole,
  MessagePreview,
  SystemEvent,
} from '@plataforma/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import {
  conversationMembers,
  conversations,
  messages,
  users,
} from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import type { AuthContext } from '../auth/index.js';
import { isUsable, UsersService } from '../users/index.js';
import { toMessage } from './message-mapper.js';
import type { MessageRow } from '../../database/schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface SummaryRow extends Record<string, unknown> {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  description: string | null;
  last_seq: string;
  last_message_at: Date;
  role: MemberRole;
  last_read_seq: string;
  muted_until: Date | null;
  member_count: string;
  unread_count: string;
  peer_id: string | null;
  lm_id: string | null;
  lm_seq: string | null;
  lm_sender_id: string | null;
  lm_type: 'text' | 'system' | null;
  lm_body: string | null;
  lm_deleted: boolean | null;
  lm_created_at: Date | null;
  lm_attachments: string | null;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  /**
   * Conversas do usuário com não lidas e última mensagem, em uma consulta.
   * Conversas diretas sem mensagens só aparecem para quem as abriu.
   */
  async list(userId: string, conversationIds?: string[]): Promise<ConversationSummary[]> {
    const filter = conversationIds?.length
      ? sql`and c.id in (${sql.join(
          conversationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
    const rows = (await this.db.execute(sql`
      select c.id, c.type, c.name, c.description, c.last_seq, c.last_message_at,
             m.role, m.last_read_seq, m.muted_until,
             (select count(*) from conversation_members x where x.conversation_id = c.id) as member_count,
             (select count(*) from messages x
               where x.conversation_id = c.id and x.seq > greatest(m.last_read_seq, m.joined_seq)
                 and x.type = 'text' and x.deleted_at is null
                 and x.sender_id is distinct from ${userId}) as unread_count,
             case when c.type = 'direct' then
               (select x.user_id from conversation_members x where x.conversation_id = c.id and x.user_id <> ${userId} limit 1)
             end as peer_id,
             lm.id as lm_id, lm.seq as lm_seq, lm.sender_id as lm_sender_id, lm.type as lm_type,
             lm.body as lm_body, lm.deleted_at is not null as lm_deleted, lm.created_at as lm_created_at,
             (select string_agg(f.original_name, ', ' order by a.position) from message_attachments a
                join files f on f.id = a.file_id where a.message_id = lm.id) as lm_attachments
        from conversation_members m
        join conversations c on c.id = m.conversation_id
        left join lateral (
          select * from messages x where x.conversation_id = c.id and x.seq > m.joined_seq
          order by x.seq desc limit 1
        ) lm on true
       where m.user_id = ${userId}
         and (c.type = 'group'
              or (c.last_seq = 0 and c.created_by = ${userId})
              -- Conversa direta que só tem comunicados enviados por mim fica fora da
              -- minha lista: quem dispara para 500 pessoas não ganha 500 conversas.
              or exists (select 1 from messages x
                          where x.conversation_id = c.id and x.seq > m.joined_seq
                            and (x.broadcast_id is null or x.sender_id is distinct from ${userId})))
         ${filter}
       order by c.last_message_at desc
    `)) as unknown as SummaryRow[];

    const people = await this.users.directoryUsers(
      rows.flatMap((r) => [r.peer_id, r.lm_sender_id]).filter((x): x is string => !!x),
    );
    return rows.map((r) => {
      const peer = r.peer_id ? (people.get(r.peer_id) ?? null) : null;
      const sender = r.lm_sender_id ? people.get(r.lm_sender_id) : undefined;
      const lastMessage: MessagePreview | null = r.lm_id
        ? {
            id: r.lm_id,
            seq: Number(r.lm_seq),
            senderId: r.lm_sender_id,
            senderName: sender?.displayName ?? null,
            type: r.lm_type!,
            text: r.lm_deleted
              ? ''
              : r.lm_body || (r.lm_attachments ? `📎 ${r.lm_attachments}` : ''),
            createdAt: new Date(r.lm_created_at!).toISOString(),
          }
        : null;
      return {
        id: r.id,
        type: r.type,
        title: r.type === 'group' ? (r.name ?? 'Grupo') : (peer?.displayName ?? 'Conversa'),
        description: r.description,
        peer,
        memberCount: Number(r.member_count),
        myRole: r.role,
        lastSeq: Number(r.last_seq),
        lastReadSeq: Number(r.last_read_seq),
        unreadCount: Number(r.unread_count),
        mutedUntil: r.muted_until ? new Date(r.muted_until).toISOString() : null,
        lastMessage,
        lastMessageAt: new Date(r.last_message_at).toISOString(),
      };
    });
  }

  async summary(userId: string, conversationId: string): Promise<ConversationSummary> {
    await this.requireMember(userId, conversationId);
    const [s] = await this.list(userId, [conversationId]);
    if (s) return s;
    // Conversa direta ainda vazia aberta pela outra pessoa: monta o resumo mesmo assim.
    const all = await this.listIncludingEmpty(userId, conversationId);
    if (!all) throw notFound();
    return all;
  }

  async detail(userId: string, conversationId: string): Promise<ConversationDetail> {
    const summary = await this.summary(userId, conversationId);
    const rows = await this.db
      .select()
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
    const people = await this.users.directoryUsers(rows.map((r) => r.userId));
    const order: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };
    const members: ConversationMember[] = rows
      .filter((r) => people.has(r.userId))
      .map((r) => ({ ...people.get(r.userId)!, role: r.role, lastReadSeq: r.lastReadSeq }))
      .sort(
        (a, b) =>
          order[a.role] - order[b.role] || a.displayName.localeCompare(b.displayName, 'pt-BR'),
      );
    return { ...summary, members };
  }

  /** Abre (ou reaproveita) a conversa direta com outra pessoa. */
  async openDirect(auth: AuthContext, otherId: string): Promise<ConversationSummary> {
    this.assertNotGuest(auth);
    if (otherId === auth.user.id) {
      throw new AppException(400, 'VALIDATION_FAILED', 'Escolha outra pessoa para conversar.');
    }
    const other = await this.users.findById(otherId);
    if (!other || !isUsable(other))
      throw new AppException(404, 'NOT_FOUND', 'Pessoa não encontrada');

    const directKey = [auth.user.id, otherId].sort().join(':');
    const id = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(conversations)
        .values({ type: 'direct', directKey, createdBy: auth.user.id })
        .onConflictDoNothing()
        .returning({ id: conversations.id });
      if (created) {
        await tx.insert(conversationMembers).values([
          { conversationId: created.id, userId: auth.user.id },
          { conversationId: created.id, userId: otherId },
        ]);
        return created.id;
      }
      const [existing] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.directKey, directKey));
      return existing!.id;
    });
    return this.summary(auth.user.id, id);
  }

  async createGroup(
    auth: AuthContext,
    input: { name: string; description?: string | null; memberIds: string[] },
  ): Promise<ConversationSummary> {
    this.assertNotGuest(auth);
    const memberIds = await this.usableIds(input.memberIds.filter((id) => id !== auth.user.id));
    const { id, sys } = await this.db.transaction(async (tx) => {
      const [conv] = await tx
        .insert(conversations)
        .values({
          type: 'group',
          name: input.name,
          description: input.description ?? null,
          createdBy: auth.user.id,
        })
        .returning({ id: conversations.id });
      await tx
        .insert(conversationMembers)
        .values([
          { conversationId: conv!.id, userId: auth.user.id, role: 'owner' as const },
          ...memberIds.map((userId) => ({ conversationId: conv!.id, userId })),
        ]);
      const sys = await this.systemMessage(tx, conv!.id, {
        event: 'group_created',
        actorId: auth.user.id,
      });
      return { id: conv!.id, sys };
    });
    await this.audit.record({
      action: 'conversation.created',
      actorId: auth.user.id,
      entityType: 'conversation',
      entityId: id,
      metadata: { name: input.name, members: memberIds.length + 1 },
    });
    await this.broadcastSummaries(id);
    await this.publish(sys);
    return this.summary(auth.user.id, id);
  }

  async update(
    auth: AuthContext,
    id: string,
    input: { name?: string; description?: string | null },
  ) {
    const m = await this.requireGroupAdmin(auth.user.id, id);
    const sys = await this.db.transaction(async (tx) => {
      await tx
        .update(conversations)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        })
        .where(eq(conversations.id, id));
      if (input.name && input.name !== m.conversation.name) {
        return this.systemMessage(tx, id, {
          event: 'renamed',
          actorId: auth.user.id,
          name: input.name,
        });
      }
      return null;
    });
    await this.audit.record({
      action: 'conversation.updated',
      actorId: auth.user.id,
      entityType: 'conversation',
      entityId: id,
      metadata: input,
    });
    await this.broadcastSummaries(id);
    if (sys) await this.publish(sys);
    return this.detail(auth.user.id, id);
  }

  async addMembers(auth: AuthContext, id: string, userIds: string[]) {
    await this.requireGroupAdmin(auth.user.id, id);
    const current = new Set(
      (
        await this.db
          .select({ u: conversationMembers.userId })
          .from(conversationMembers)
          .where(eq(conversationMembers.conversationId, id))
      ).map((r) => r.u),
    );
    const toAdd = await this.usableIds(userIds.filter((u) => !current.has(u)));
    if (!toAdd.length) return this.detail(auth.user.id, id);
    const people = await this.users.directoryUsers(toAdd);

    const sys = await this.db.transaction(async (tx) => {
      const [conv] = await tx
        .select({ lastSeq: conversations.lastSeq })
        .from(conversations)
        .where(eq(conversations.id, id))
        .for('update');
      // Quem entra agora vê a partir daqui, não o histórico anterior.
      await tx.insert(conversationMembers).values(
        toAdd.map((userId) => ({
          conversationId: id,
          userId,
          joinedSeq: conv!.lastSeq,
          lastReadSeq: conv!.lastSeq,
        })),
      );
      return this.systemMessage(tx, id, {
        event: 'members_added',
        actorId: auth.user.id,
        userIds: toAdd,
        names: toAdd.map((u) => people.get(u)?.displayName ?? ''),
      });
    });
    await this.audit.record({
      action: 'conversation.members_added',
      actorId: auth.user.id,
      entityType: 'conversation',
      entityId: id,
      metadata: { userIds: toAdd },
    });
    await this.broadcastSummaries(id);
    await this.publish(sys);
    return this.detail(auth.user.id, id);
  }

  /** Remove alguém do grupo, ou sai do grupo quando `userId` é o próprio usuário. */
  async removeMember(auth: AuthContext, id: string, userId: string): Promise<void> {
    const me = await this.requireMember(auth.user.id, id);
    if (me.conversation.type !== 'group') {
      throw new AppException(409, 'CONFLICT', 'Não é possível sair de uma conversa individual.');
    }
    const leaving = userId === auth.user.id;
    const [target] = await this.db
      .select()
      .from(conversationMembers)
      .where(
        and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)),
      );
    if (!target) throw new AppException(404, 'NOT_FOUND', 'Esta pessoa não está no grupo.');
    if (!leaving) {
      if (me.member.role === 'member')
        throw forbidden('Somente administradores do grupo podem remover pessoas.');
      if (target.role === 'owner') throw forbidden('O dono do grupo não pode ser removido.');
      if (target.role === 'admin' && me.member.role !== 'owner')
        throw forbidden('Somente o dono pode remover administradores.');
    }
    const person = (await this.users.directoryUsers([userId])).get(userId);

    const sys = await this.db.transaction(async (tx) => {
      await tx
        .delete(conversationMembers)
        .where(
          and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)),
        );
      if (leaving && target.role === 'owner') await this.transferOwnership(tx, id);
      return this.systemMessage(
        tx,
        id,
        leaving
          ? { event: 'member_left', actorId: userId }
          : {
              event: 'member_removed',
              actorId: auth.user.id,
              userId,
              name: person?.displayName ?? '',
            },
      );
    });
    if (!leaving) {
      await this.audit.record({
        action: 'conversation.member_removed',
        actorId: auth.user.id,
        entityType: 'conversation',
        entityId: id,
        metadata: { userId },
      });
    }
    this.events.emit('conversation.left', { conversationId: id, userIds: [userId] });
    await this.broadcastSummaries(id);
    await this.publish(sys);
  }

  async setMemberRole(auth: AuthContext, id: string, userId: string, role: 'admin' | 'member') {
    const me = await this.requireGroupAdmin(auth.user.id, id);
    if (me.member.role !== 'owner' && role === 'member')
      throw forbidden('Somente o dono pode retirar administradores.');
    const updated = await this.db
      .update(conversationMembers)
      .set({ role })
      .where(
        and(
          eq(conversationMembers.conversationId, id),
          eq(conversationMembers.userId, userId),
          sql`${conversationMembers.role} <> 'owner'`,
        ),
      )
      .returning();
    if (!updated.length) throw new AppException(404, 'NOT_FOUND', 'Membro não encontrado');
    await this.broadcastSummaries(id, [userId]);
    return this.detail(auth.user.id, id);
  }

  async setMuted(
    userId: string,
    id: string,
    mutedUntil: string | null,
  ): Promise<ConversationSummary> {
    await this.requireMember(userId, id);
    await this.db
      .update(conversationMembers)
      .set({ mutedUntil: mutedUntil ? new Date(mutedUntil) : null })
      .where(
        and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)),
      );
    const s = await this.summary(userId, id);
    this.events.emit('conversation.changed', { summaries: new Map([[userId, s]]) });
    return s;
  }

  async markRead(userId: string, id: string, seq: number): Promise<number> {
    const m = await this.requireMember(userId, id);
    const target = Math.min(seq, m.conversation.lastSeq);
    if (target <= m.member.lastReadSeq) return m.member.lastReadSeq;
    await this.db
      .update(conversationMembers)
      .set({ lastReadSeq: sql`greatest(${conversationMembers.lastReadSeq}, ${target})` })
      .where(
        and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)),
      );
    this.events.emit('read.updated', {
      conversationId: id,
      userId,
      seq: target,
      recipientIds: await this.memberIds(id),
    });
    return target;
  }

  /* ------------------------------ utilitários ------------------------------ */

  async requireMember(userId: string, conversationId: string) {
    const [row] = await this.db
      .select({ member: conversationMembers, conversation: conversations })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.db
      .select({ u: conversationMembers.userId })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
    return rows.map((r) => r.u);
  }

  /** Grava uma mensagem de sistema ("Fulano adicionou…") com o próximo número de sequência. */
  async systemMessage(tx: Tx, conversationId: string, event: SystemEvent) {
    const [conv] = await tx
      .update(conversations)
      .set({ lastSeq: sql`${conversations.lastSeq} + 1`, lastMessageAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning({ lastSeq: conversations.lastSeq });
    const [row] = await tx
      .insert(messages)
      .values({
        conversationId,
        seq: conv!.lastSeq,
        senderId: event.actorId,
        type: 'system',
        system: event,
      })
      .returning();
    return row!;
  }

  /** Entrega uma mensagem (de sistema) aos membros atuais, depois da transação confirmada. */
  async publish(row: MessageRow): Promise<void> {
    this.events.emit('message.created', {
      message: toMessage(row),
      recipientIds: await this.memberIds(row.conversationId),
    });
  }

  /** Envia o resumo atualizado a cada membro (cada um vê não lidas e título próprios). */
  async broadcastSummaries(conversationId: string, only?: string[]): Promise<void> {
    const ids = only ?? (await this.memberIds(conversationId));
    const entries = await Promise.all(
      ids.map(async (u) => [u, await this.summary(u, conversationId).catch(() => null)] as const),
    );
    const summaries = new Map(entries.filter((e): e is [string, ConversationSummary] => !!e[1]));
    this.events.emit('conversation.changed', { summaries });
  }

  private async listIncludingEmpty(
    userId: string,
    conversationId: string,
  ): Promise<ConversationSummary | null> {
    const { member, conversation } = await this.requireMember(userId, conversationId);
    const others = (await this.memberIds(conversationId)).filter((u) => u !== userId);
    const people = await this.users.directoryUsers(others);
    const peer = conversation.type === 'direct' ? (people.get(others[0] ?? '') ?? null) : null;
    return {
      id: conversation.id,
      type: conversation.type,
      title:
        conversation.type === 'group'
          ? (conversation.name ?? 'Grupo')
          : (peer?.displayName ?? 'Conversa'),
      description: conversation.description,
      peer,
      memberCount: others.length + 1,
      myRole: member.role,
      lastSeq: conversation.lastSeq,
      lastReadSeq: member.lastReadSeq,
      unreadCount: 0,
      mutedUntil: member.mutedUntil?.toISOString() ?? null,
      lastMessage: null,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
    };
  }

  private async transferOwnership(tx: Tx, conversationId: string): Promise<void> {
    const [next] = await tx
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId))
      .orderBy(
        sql`case ${conversationMembers.role} when 'admin' then 0 else 1 end`,
        conversationMembers.joinedAt,
      )
      .limit(1);
    if (next) {
      await tx
        .update(conversationMembers)
        .set({ role: 'owner' })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, next.userId),
          ),
        );
    }
  }

  private async requireGroupAdmin(userId: string, id: string) {
    const m = await this.requireMember(userId, id);
    if (m.conversation.type !== 'group')
      throw new AppException(409, 'CONFLICT', 'Esta ação vale apenas para grupos.');
    if (m.member.role === 'member')
      throw forbidden('Somente administradores do grupo podem fazer isso.');
    return m;
  }

  private async usableIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(ids)]));
    const ok = rows.filter(isUsable).map((r) => r.id);
    if (ok.length !== new Set(ids).size) {
      throw new AppException(
        400,
        'VALIDATION_FAILED',
        'Algumas pessoas escolhidas não estão ativas no sistema.',
      );
    }
    return ok;
  }

  private assertNotGuest(auth: AuthContext): void {
    if (auth.user.kind === 'guest') {
      throw forbidden('Convidados participam apenas das conversas em que foram incluídos.');
    }
  }
}

const notFound = () => new AppException(404, 'NOT_FOUND', 'Conversa não encontrada');
const forbidden = (message: string) => new AppException(403, 'FORBIDDEN', message);
