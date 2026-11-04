import { and, isNotNull, lt, or } from 'drizzle-orm';
import type { Database } from '../database/database.js';
import { sessions } from '../database/schema/index.js';

export const MAINTENANCE_QUEUE = 'maintenance';

/** Histórico de sessões encerradas mantido para auditoria. */
const SESSION_HISTORY_DAYS = 30;

export const maintenanceJobs = {
  /**
   * Remove do histórico sessões encerradas ou expiradas há mais de 30 dias.
   * (A remoção definitiva de mensagens excluídas após 48 h entra aqui na fase 1.)
   */
  'sessions.cleanup': async (db: Database): Promise<{ removed: number }> => {
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
} satisfies Record<string, (db: Database) => Promise<unknown>>;

export type MaintenanceJobName = keyof typeof maintenanceJobs;

/** Agenda das tarefas recorrentes (intervalo em milissegundos). */
export const maintenanceSchedule: Record<MaintenanceJobName, number> = {
  'sessions.cleanup': 60 * 60_000,
};
