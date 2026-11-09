import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConversationSummary, createChannelSchema } from '@plataforma/contracts';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import { conversationMembers, conversations, orgUnits } from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import type { AuthContext } from '../auth/index.js';
import type { Grants } from '../rbac/index.js';
import { ConversationsService } from './conversations.service.js';

type CreateInput = z.output<typeof createChannelSchema>;

/** Pessoas que podem estar num canal: ativas, não excluídas, convidados dentro do prazo. */
const usable = sql`u.deleted_at is null and u.status = 'active'
  and (u.access_expires_at is null or u.access_expires_at > now())`;

/**
 * Canais de aviso. Um canal é um grupo em que só os administradores publicam. Quando
 * ligado a uma unidade, as pessoas lotadas nela (e, se marcado, nas subunidades)
 * entram e saem sozinhas: a sincronização roda ao criar o canal, quando alguém muda
 * de lotação ou de situação, e quando o organograma muda.
 */
@Injectable()
export class ChannelsService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(ChannelsService.name);
  private closing = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly conversations: ConversationsService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const fail = (e: unknown) =>
      !this.closing && this.logger.error(`Sincronização de canais falhou: ${String(e)}`);
    this.events.on('user.membership_changed', ({ userId }) => {
      if (!this.closing) void this.syncUser(userId).catch(fail);
    });
    this.events.on('org.changed', () => {
      if (!this.closing) void this.syncAll().catch(fail);
    });
  }

  /** No desligamento, o banco fecha logo depois: não começa sincronização nova. */
  beforeApplicationShutdown(): void {
    this.closing = true;
  }

  async create(
    auth: AuthContext,
    grants: Grants,
    input: CreateInput,
  ): Promise<ConversationSummary> {
    if (auth.user.kind === 'guest') {
      throw new AppException(403, 'FORBIDDEN', 'Convidados não criam canais.');
    }
    let unitPath: string | null = null;
    if (input.orgUnitId) {
      const [unit] = await this.db
        .select()
        .from(orgUnits)
        .where(eq(orgUnits.id, input.orgUnitId))
        .limit(1);
      if (!unit || !unit.isActive)
        throw new AppException(404, 'NOT_FOUND', 'Unidade não encontrada');
      unitPath = unit.path;
    }
    const allowed = unitPath
      ? grants.canOn('conversations.create_channel', unitPath)
      : grants.hasAny('conversations.create_channel');
    if (!allowed) {
      throw new AppException(
        403,
        'FORBIDDEN',
        unitPath
          ? 'Você não pode criar canais para esta unidade.'
          : 'Você não tem permissão para criar canais de aviso.',
      );
    }
    const manual = [...new Set(input.memberIds)].filter((id) => id !== auth.user.id);

    const { id, sys } = await this.db.transaction(async (tx) => {
      const [conv] = await tx
        .insert(conversations)
        .values({
          type: 'group',
          isChannel: true,
          name: input.name,
          description: input.description ?? null,
          orgUnitId: input.orgUnitId,
          includeSubunits: input.includeSubunits,
          createdBy: auth.user.id,
        })
        .returning({ id: conversations.id });
      await tx
        .insert(conversationMembers)
        .values({ conversationId: conv!.id, userId: auth.user.id, role: 'owner' });
      if (manual.length) {
        await tx.execute(sql`
          insert into conversation_members (conversation_id, user_id)
          select ${conv!.id}, u.id from users u
           where u.id in (${sql.join(
             manual.map((m) => sql`${m}`),
             sql`, `,
           )}) and ${usable}
          on conflict do nothing`);
      }
      const sys = await this.conversations.systemMessage(tx, conv!.id, {
        event: 'channel_created',
        actorId: auth.user.id,
      });
      return { id: conv!.id, sys };
    });
    if (input.orgUnitId) await this.syncChannel(id, { notify: false });
    await this.audit.record({
      action: 'conversation.created',
      actorId: auth.user.id,
      entityType: 'conversation',
      entityId: id,
      metadata: {
        name: input.name,
        channel: true,
        orgUnitId: input.orgUnitId,
        includeSubunits: input.includeSubunits,
      },
    });
    await this.conversations.broadcastSummaries(id);
    await this.conversations.publish(sys);
    return this.conversations.summary(auth.user.id, id);
  }

  /**
   * Acerta os membros automáticos de um canal de unidade: entra quem está lotado e
   * sai quem não está mais. Membros escolhidos à mão e administradores ficam.
   */
  async syncChannel(channelId: string, opts = { notify: true }): Promise<void> {
    const changes = await this.db.transaction(async (tx) => {
      const added = (await tx.execute(sql`
        insert into conversation_members (conversation_id, user_id, auto_joined, last_read_seq)
        select c.id, u.id, true, c.last_seq
          from conversations c
          join org_units cu on cu.id = c.org_unit_id
          join users u on ${usable}
          join org_units uu on uu.id = u.org_unit_id
         where c.id = ${channelId} and c.is_channel
           and (case when c.include_subunits then uu.path like cu.path || '%' else uu.id = cu.id end)
        on conflict do nothing
        returning user_id`)) as unknown as { user_id: string }[];
      const removed = (await tx.execute(sql`
        delete from conversation_members m
         using conversations c
         where m.conversation_id = c.id and c.id = ${channelId} and m.auto_joined
           and not exists (
             select 1 from users u
               join org_units uu on uu.id = u.org_unit_id
               join org_units cu on cu.id = c.org_unit_id
              where u.id = m.user_id and ${usable}
                and (case when c.include_subunits then uu.path like cu.path || '%' else uu.id = cu.id end))
        returning m.user_id`)) as unknown as { user_id: string }[];
      return { added: added.map((r) => r.user_id), removed: removed.map((r) => r.user_id) };
    });
    if (!opts.notify) return;
    if (changes.added.length) await this.conversations.broadcastSummaries(channelId, changes.added);
    if (changes.removed.length) {
      this.events.emit('conversation.left', {
        conversationId: channelId,
        userIds: changes.removed,
      });
    }
  }

  /** Depois de alguém mudar de lotação ou de situação. */
  async syncUser(userId: string): Promise<void> {
    const channels = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.isChannel, true), isNotNull(conversations.orgUnitId)));
    if (!channels.length) return;
    const ids = channels.map((c) => c.id);
    // Só os canais em que a pessoa deveria estar ou está automaticamente.
    const relevant = (await this.db.execute(sql`
      select c.id from conversations c
        join org_units cu on cu.id = c.org_unit_id
        left join users u on u.id = ${userId}
        left join org_units uu on uu.id = u.org_unit_id
       where c.id in (${sql.join(
         ids.map((i) => sql`${i}`),
         sql`, `,
       )})
         and ((case when c.include_subunits then uu.path like cu.path || '%' else uu.id = cu.id end)
              or exists (select 1 from conversation_members m
                          where m.conversation_id = c.id and m.user_id = ${userId} and m.auto_joined))
    `)) as unknown as { id: string }[];
    for (const c of relevant) await this.syncChannel(c.id);
  }

  async syncAll(): Promise<void> {
    const channels = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.isChannel, true), isNotNull(conversations.orgUnitId)));
    for (const c of channels) await this.syncChannel(c.id);
  }

  /** Canais em que só administradores publicam: confere antes de enviar. */
  static assertCanPost(conversation: { isChannel: boolean }, role: string): void {
    if (conversation.isChannel && role === 'member') {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Somente os administradores do canal publicam aqui.',
      );
    }
  }
}
