import { MESSAGE_RULES } from '@plataforma/contracts';
import { and, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database } from '../database/database.js';
import {
  files,
  messageAttachments,
  messageEdits,
  messages,
  sessions,
} from '../database/schema/index.js';

export const MAINTENANCE_QUEUE = 'maintenance';

/** Histórico de sessões encerradas mantido para auditoria. */
const SESSION_HISTORY_DAYS = 30;
/** Uploads que nunca foram anexados a uma mensagem são descartados após este prazo. */
const ORPHAN_FILE_HOURS = 24;
const BATCH = 500;

export interface JobContext {
  db: Database;
  filesDir: string;
}

async function removeStored(ctx: JobContext, keys: (string | null)[]): Promise<void> {
  const root = resolve(ctx.filesDir);
  for (const key of keys) {
    if (!key) continue;
    const p = resolve(root, key);
    if (p.startsWith(root)) await rm(p, { force: true });
  }
}

/** Apaga do disco e do banco os arquivos que nenhuma mensagem referencia mais. */
async function deleteUnreferenced(ctx: JobContext, fileIds: string[]): Promise<number> {
  if (!fileIds.length) return 0;
  const rows = await ctx.db
    .select({ id: files.id, storageKey: files.storageKey, thumbnailKey: files.thumbnailKey })
    .from(files)
    .where(
      and(
        inArray(files.id, fileIds),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(messageAttachments)
            .where(eq(messageAttachments.fileId, files.id)),
        ),
      ),
    );
  for (const r of rows) await removeStored(ctx, [r.storageKey, r.thumbnailKey]);
  if (rows.length)
    await ctx.db.delete(files).where(
      inArray(
        files.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.length;
}

export const maintenanceJobs = {
  /** Remove do histórico sessões encerradas ou expiradas há mais de 30 dias. */
  'sessions.cleanup': async ({ db }: JobContext) => {
    const cutoff = new Date(Date.now() - SESSION_HISTORY_DAYS * 86_400_000);
    const removed = await db
      .delete(sessions)
      .where(
        or(
          and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff)),
          lt(sessions.expiresAt, cutoff),
        ),
      )
      .returning({ id: sessions.id });
    return { removed: removed.length };
  },

  /**
   * Decisão do produto: mensagem apagada fica 48 h em exclusão lógica e então tem
   * o conteúdo, o histórico de edições e os anexos removidos em definitivo.
   */
  'messages.purge': async (ctx: JobContext) => {
    const cutoff = new Date(Date.now() - MESSAGE_RULES.deletedRetentionHours * 3_600_000);
    let purged = 0;
    let filesRemoved = 0;
    for (;;) {
      const batch = await ctx.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            isNotNull(messages.deletedAt),
            lt(messages.deletedAt, cutoff),
            isNull(messages.purgedAt),
          ),
        )
        .limit(BATCH);
      if (!batch.length) break;
      const ids = batch.map((b) => b.id);
      const attached = await ctx.db.transaction(async (tx) => {
        const att = await tx
          .delete(messageAttachments)
          .where(inArray(messageAttachments.messageId, ids))
          .returning({ fileId: messageAttachments.fileId });
        await tx.delete(messageEdits).where(inArray(messageEdits.messageId, ids));
        await tx
          .update(messages)
          .set({ body: '', purgedAt: new Date() })
          .where(inArray(messages.id, ids));
        return att.map((a) => a.fileId);
      });
      filesRemoved += await deleteUnreferenced(ctx, attached);
      purged += ids.length;
      if (batch.length < BATCH) break;
    }
    return { purged, filesRemoved };
  },

  /** Arquivos enviados e nunca anexados (ex.: a pessoa desistiu da mensagem). */
  'files.orphans': async (ctx: JobContext) => {
    const cutoff = new Date(Date.now() - ORPHAN_FILE_HOURS * 3_600_000);
    const rows = await ctx.db
      .select({ id: files.id })
      .from(files)
      .where(and(isNull(files.attachedAt), lt(files.createdAt, cutoff)))
      .limit(BATCH);
    return {
      removed: await deleteUnreferenced(
        ctx,
        rows.map((r) => r.id),
      ),
    };
  },
} satisfies Record<string, (ctx: JobContext) => Promise<unknown>>;

export type MaintenanceJobName = keyof typeof maintenanceJobs;

/** Agenda das tarefas recorrentes (intervalo em milissegundos). */
export const maintenanceSchedule: Record<MaintenanceJobName, number> = {
  'sessions.cleanup': 60 * 60_000,
  'messages.purge': 15 * 60_000,
  'files.orphans': 60 * 60_000,
};
