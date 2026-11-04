import { index, jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common.js';
import { users } from './users.js';

/**
 * Registro de auditoria: somente inserção. Particionamento mensal será
 * adicionado quando o volume justificar (ver docs/adr/0004).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: varchar({ length: 64 }).notNull(),
    entityType: varchar({ length: 64 }),
    entityId: varchar({ length: 64 }),
    ip: varchar({ length: 45 }),
    userAgent: varchar({ length: 512 }),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
    index('audit_logs_action_idx').on(t.action, t.createdAt),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
