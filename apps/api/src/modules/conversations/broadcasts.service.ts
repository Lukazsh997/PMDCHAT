import { Inject, Injectable } from '@nestjs/common';
import {
  BROADCAST_RULES,
  type BroadcastResult,
  type BroadcastScopes,
  type sendBroadcastSchema,
} from '@plataforma/contracts';
import { and, asc, count, eq, gt, inArray, isNull, like, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import {
  broadcasts,
  conversationMembers,
  conversations,
  files,
  messageAttachments,
  messages,
  orgUnits,
  type OrgUnitRow,
  users,
} from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import type { AuthContext } from '../auth/index.js';
import { toUploaded } from '../files/index.js';
import type { Grants } from '../rbac/index.js';
import { toMessage } from './message-mapper.js';

type Input = z.output<typeof sendBroadcastSchema>;
const BATCH = 500;

/**
 * Comunicados em massa. Cada pessoa da unidade recebe o texto na conversa direta com
 * quem enviou (como uma lista de transmissão): a resposta vai só para o remetente e
 * ninguém vê quem mais recebeu. O registro em `broadcasts` guarda o envio para consulta.
 */
@Injectable()
export class BroadcastsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  scopes(grants: Grants): BroadcastScopes {
    const paths = grants.scopePaths('broadcast.send');
    if (paths === null) return { global: true, unitIds: [] };
    return { global: false, unitIds: paths.map((p) => p.split('/').at(-2)!) };
  }

  /** Quantas pessoas receberiam (para a tela de confirmação). */
  async preview(
    auth: AuthContext,
    grants: Grants,
    orgUnitId: string,
    includeSubunits: boolean,
  ): Promise<number> {
    const unit = await this.allowedUnit(grants, orgUnitId);
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
      .where(and(...this.recipientFilter(auth.user.id, unit, includeSubunits)));
    return row?.n ?? 0;
  }

  async send(
    auth: AuthContext,
    grants: Grants,
    input: Input,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<BroadcastResult> {
    const unit = await this.allowedUnit(grants, input.orgUnitId);
    const senderId = auth.user.id;

    // Reenvio do mesmo comunicado (rede caiu): devolve o resultado do primeiro.
    const [previous] = await this.db
      .select({ id: broadcasts.id, recipientCount: broadcasts.recipientCount })
      .from(broadcasts)
      .where(and(eq(broadcasts.senderId, senderId), eq(broadcasts.clientId, input.clientId)))
      .limit(1);
    if (previous) return previous;

    const recipients = (
      await this.db
        .select({ id: users.id })
        .from(users)
        .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
        .where(and(...this.recipientFilter(senderId, unit, input.includeSubunits)))
        .orderBy(asc(users.id))
        .limit(BROADCAST_RULES.maxRecipients + 1)
    ).map((r) => r.id);
    if (!recipients.length) {
      throw new AppException(409, 'CONFLICT', 'Não há pessoas ativas nesta unidade para receber.');
    }
    if (recipients.length > BROADCAST_RULES.maxRecipients) {
      throw new AppException(
        400,
        'VALIDATION_FAILED',
        `Um comunicado pode ter no máximo ${BROADCAST_RULES.maxRecipients} destinatários. Escolha uma unidade menor.`,
      );
    }
    const unitName = unit.acronym ? `${unit.name} (${unit.acronym})` : unit.name;

    const result = await this.db.transaction(async (tx) => {
      const attached = input.attachmentIds.length
        ? await tx
            .update(files)
            .set({ attachedAt: new Date() })
            .where(
              and(
                inArray(files.id, input.attachmentIds),
                eq(files.uploaderId, senderId),
                isNull(files.attachedAt),
              ),
            )
            .returning()
        : [];
      if (attached.length !== new Set(input.attachmentIds).size) {
        throw new AppException(
          400,
          'VALIDATION_FAILED',
          'Um dos anexos não está disponível. Envie o arquivo de novo.',
        );
      }
      const fileOrder = input.attachmentIds.map((id) => attached.find((f) => f.id === id)!);

      const [broadcast] = await tx
        .insert(broadcasts)
        .values({
          senderId,
          orgUnitId: unit.id,
          unitName,
          includeSubunits: input.includeSubunits,
          body: input.body,
          recipientCount: recipients.length,
          clientId: input.clientId,
        })
        .returning();

      const delivered: { recipientId: string; row: typeof messages.$inferSelect }[] = [];
      for (let i = 0; i < recipients.length; i += BATCH) {
        const chunk = recipients.slice(i, i + BATCH);
        const keyOf = new Map(chunk.map((r) => [[senderId, r].sort().join(':'), r]));
        const keys = [...keyOf.keys()];

        // Abre as conversas diretas que ainda não existem.
        await tx
          .insert(conversations)
          .values(
            keys.map((directKey) => ({ type: 'direct' as const, directKey, createdBy: senderId })),
          )
          .onConflictDoNothing();
        const convs = await tx
          .select({ id: conversations.id, directKey: conversations.directKey })
          .from(conversations)
          .where(inArray(conversations.directKey, keys))
          .orderBy(asc(conversations.id))
          // Trava em ordem fixa: dois envios simultâneos não se bloqueiam mutuamente.
          .for('update');
        await tx
          .insert(conversationMembers)
          .values(
            convs.flatMap((c) => [
              { conversationId: c.id, userId: senderId },
              { conversationId: c.id, userId: keyOf.get(c.directKey!)! },
            ]),
          )
          .onConflictDoNothing();
        const seqs = await tx
          .update(conversations)
          .set({ lastSeq: sql`${conversations.lastSeq} + 1`, lastMessageAt: new Date() })
          .where(
            inArray(
              conversations.id,
              convs.map((c) => c.id),
            ),
          )
          .returning({ id: conversations.id, lastSeq: conversations.lastSeq });
        const recipientOf = new Map(convs.map((c) => [c.id, keyOf.get(c.directKey!)!]));
        const rows = await tx
          .insert(messages)
          .values(
            seqs.map((s) => ({
              conversationId: s.id,
              seq: s.lastSeq,
              senderId,
              body: input.body,
              clientId: input.clientId,
              broadcastId: broadcast!.id,
            })),
          )
          .returning();
        if (fileOrder.length) {
          await tx
            .insert(messageAttachments)
            .values(
              rows.flatMap((m) =>
                fileOrder.map((f, position) => ({ messageId: m.id, fileId: f.id, position })),
              ),
            );
        }
        // A mensagem enviada conta como lida por quem enviou.
        await tx.execute(sql`
          update conversation_members cm set last_read_seq = v.seq
            from (values ${sql.join(
              seqs.map((s) => sql`(${s.id}::uuid, ${s.lastSeq}::bigint)`),
              sql`, `,
            )}) as v(cid, seq)
           where cm.conversation_id = v.cid and cm.user_id = ${senderId}`);
        for (const row of rows)
          delivered.push({ recipientId: recipientOf.get(row.conversationId)!, row });
      }
      return { broadcast: broadcast!, delivered, attachments: fileOrder.map(toUploaded) };
    });

    const ref = {
      id: result.broadcast.id,
      unitName,
      includeSubunits: input.includeSubunits,
    };
    // Entrega só a quem recebe: o remetente não ganha centenas de conversas na tela.
    for (const d of result.delivered) {
      this.events.emit('message.created', {
        message: toMessage(d.row, result.attachments, ref),
        recipientIds: [d.recipientId],
      });
    }
    await this.audit.record({
      action: 'broadcast.sent',
      actorId: senderId,
      entityType: 'broadcast',
      entityId: result.broadcast.id,
      ...meta,
      metadata: {
        orgUnitId: unit.id,
        unitName,
        includeSubunits: input.includeSubunits,
        recipients: recipients.length,
        attachments: input.attachmentIds.length,
      },
    });
    return { id: result.broadcast.id, recipientCount: recipients.length };
  }

  private async allowedUnit(grants: Grants, orgUnitId: string): Promise<OrgUnitRow> {
    const [unit] = await this.db.select().from(orgUnits).where(eq(orgUnits.id, orgUnitId)).limit(1);
    if (!unit || !unit.isActive) throw new AppException(404, 'NOT_FOUND', 'Unidade não encontrada');
    if (!grants.canOn('broadcast.send', unit.path)) {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Você não pode enviar comunicados para esta unidade.',
      );
    }
    return unit;
  }

  private recipientFilter(senderId: string, unit: OrgUnitRow, includeSubunits: boolean): SQL[] {
    return [
      isNull(users.deletedAt),
      eq(users.status, 'active'),
      or(isNull(users.accessExpiresAt), gt(users.accessExpiresAt, new Date()))!,
      ne(users.id, senderId),
      includeSubunits ? like(orgUnits.path, `${unit.path}%`) : eq(users.orgUnitId, unit.id),
    ];
  }
}
