import { Inject, Injectable } from '@nestjs/common';
import {
  BROADCAST_RULES,
  type BroadcastPreview,
  type BroadcastResult,
  type BroadcastScopes,
  type broadcastTargetsSchema,
  type sendBroadcastSchema,
} from '@plataforma/contracts';
import { and, asc, eq, gt, inArray, isNull, like, ne, or, type SQL, sql } from 'drizzle-orm';
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
  users,
} from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import type { AuthContext } from '../auth/index.js';
import { toUploaded } from '../files/index.js';
import type { Grants } from '../rbac/index.js';
import { toMessage } from './message-mapper.js';

type Input = z.output<typeof sendBroadcastSchema>;
type Targets = z.output<typeof broadcastTargetsSchema>;
const BATCH = 500;

/**
 * Comunicados em massa. Cada destinatário recebe o texto na conversa direta com
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

  /** Quantas pessoas receberiam (mostrado no botão de envio). */
  async preview(auth: AuthContext, grants: Grants, targets: Targets): Promise<BroadcastPreview> {
    const r = await this.resolve(auth, grants, targets);
    return { recipientCount: r.recipients.length, limit: r.limit };
  }

  async send(
    auth: AuthContext,
    grants: Grants,
    input: Input,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<BroadcastResult> {
    const senderId = auth.user.id;

    // Reenvio do mesmo comunicado (rede caiu): devolve o resultado do primeiro.
    const [previous] = await this.db
      .select({ id: broadcasts.id, recipientCount: broadcasts.recipientCount })
      .from(broadcasts)
      .where(and(eq(broadcasts.senderId, senderId), eq(broadcasts.clientId, input.clientId)))
      .limit(1);
    if (previous) return previous;

    const { recipients, label, units, people, limit } = await this.resolve(auth, grants, input);
    if (!recipients.length) {
      throw new AppException(409, 'CONFLICT', 'Nenhum dos destinatários escolhidos está ativo.');
    }
    if (limit !== null && recipients.length > limit) {
      throw new AppException(
        400,
        'VALIDATION_FAILED',
        `Este envio alcança ${recipients.length} pessoas. Sem o papel de Comunicador para os setores escolhidos, o limite é ${limit} pessoas por envio.`,
      );
    }

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
          orgUnitId: units[0]?.unit.id ?? null,
          label,
          includeSubunits: units.some((u) => u.includeSubunits),
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

    const ref = { id: result.broadcast.id, label };
    // Entrega só a quem recebe: o remetente não ganha centenas de conversas na tela.
    for (const d of result.delivered) {
      this.events.emit('message.created', {
        message: toMessage(d.row, { attachments: result.attachments, broadcast: ref }),
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
        label,
        units: units.map((u) => ({
          orgUnitId: u.unit.id,
          name: u.unit.name,
          includeSubunits: u.includeSubunits,
        })),
        people,
        recipients: recipients.length,
        attachments: input.attachmentIds.length,
      },
    });
    return { id: result.broadcast.id, recipientCount: recipients.length };
  }

  /**
   * Destinatários sem repetir: pessoas escolhidas + pessoas ativas dos setores. Setores
   * exigem a permissão de comunicados sobre a unidade; pessoas, não (todos falam com
   * todos), mas sem a permissão o envio fica limitado a poucas pessoas.
   */
  private async resolve(auth: AuthContext, grants: Grants, t: Targets) {
    if (auth.user.kind === 'guest') {
      throw new AppException(403, 'FORBIDDEN', 'Convidados não enviam comunicados.');
    }
    const unitIds = [...new Set(t.units.map((u) => u.orgUnitId))];
    const rows = unitIds.length
      ? await this.db.select().from(orgUnits).where(inArray(orgUnits.id, unitIds))
      : [];
    const units = t.units
      .filter((x, i, all) => all.findIndex((y) => y.orgUnitId === x.orgUnitId) === i)
      .map((x) => {
        const unit = rows.find((r) => r.id === x.orgUnitId);
        if (!unit || !unit.isActive)
          throw new AppException(404, 'NOT_FOUND', 'Setor não encontrado');
        return {
          unit,
          includeSubunits: x.includeSubunits,
          allowed: grants.canOn('broadcast.send', unit.path),
        };
      });

    const userIds = [...new Set(t.userIds)].filter((id) => id !== auth.user.id);

    const active = (): SQL[] => [
      isNull(users.deletedAt),
      eq(users.status, 'active'),
      or(isNull(users.accessExpiresAt), gt(users.accessExpiresAt, new Date()))!,
      ne(users.id, auth.user.id),
    ];
    const who: SQL[] = [];
    if (userIds.length) who.push(inArray(users.id, userIds));
    for (const u of units) {
      who.push(
        u.includeSubunits ? like(orgUnits.path, `${u.unit.path}%`) : eq(users.orgUnitId, u.unit.id),
      );
    }
    const found = await this.db
      .select({ id: users.id })
      .from(users)
      .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
      .where(and(...active(), or(...who)))
      .orderBy(asc(users.id))
      .limit(BROADCAST_RULES.maxRecipients + 1);
    if (found.length > BROADCAST_RULES.maxRecipients) {
      throw new AppException(
        400,
        'VALIDATION_FAILED',
        `Um comunicado pode ter no máximo ${BROADCAST_RULES.maxRecipients} destinatários. Escolha menos setores.`,
      );
    }

    // Só diz "e subunidades" quando o setor tem mesmo unidades abaixo.
    const withChildren = new Set(
      units.length
        ? (
            await this.db
              .select({ parentId: orgUnits.parentId })
              .from(orgUnits)
              .where(
                inArray(
                  orgUnits.parentId,
                  units.map((u) => u.unit.id),
                ),
              )
          ).map((r) => r.parentId)
        : [],
    );
    const parts = units.map(
      (u) =>
        `${u.unit.acronym || u.unit.name}${u.includeSubunits && withChildren.has(u.unit.id) ? ' e subunidades' : ''}`,
    );
    if (userIds.length)
      parts.push(`${userIds.length} ${userIds.length === 1 ? 'pessoa' : 'pessoas'}`);
    const label = (
      parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0]!
    ).slice(0, 200);

    // Sem a permissão de comunicado sobre algum setor escolhido (ou sem nenhuma), o
    // envio vale como mensagens individuais: no máximo algumas dezenas de pessoas.
    const limited =
      units.some((u) => !u.allowed) || (!units.length && !grants.hasAny('broadcast.send'));
    return {
      recipients: found.map((r) => r.id),
      label,
      units,
      people: userIds.length,
      limit: limited ? BROADCAST_RULES.maxPeopleWithoutPermission : null,
    };
  }
}
