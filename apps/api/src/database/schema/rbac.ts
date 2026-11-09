import { boolean, index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, updatedAt } from './_common.js';
import { orgUnits } from './org.js';
import { users } from './users.js';

/**
 * Papéis editáveis no painel. As permissões são chaves do catálogo fixo em
 * `@plataforma/contracts`; o super administrador sempre tem todas (ver PermissionService).
 */
export const roles = pgTable('roles', {
  key: varchar({ length: 32 }).primaryKey(),
  name: varchar({ length: 80 }).notNull(),
  description: varchar({ length: 240 }).notNull().default(''),
  scoped: boolean().notNull(),
  isSystem: boolean().notNull().default(false),
  permissions: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Atribuição de papel: quem (usuário) tem qual papel (chave do catálogo em
 * `@plataforma/contracts`) e onde (global ou numa unidade e suas descendentes).
 */
export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar({ length: 32 })
      .notNull()
      .references(() => roles.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
    orgUnitId: uuid().references(() => orgUnits.id, { onDelete: 'cascade' }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** manual = atribuída no painel; ldap = vem de um grupo do AD (a sincronização mantém). */
    source: varchar({ length: 16 }).notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [
    index('role_assignments_user_idx').on(t.userId),
    uniqueIndex('role_assignments_uq').on(
      t.userId,
      t.role,
      sql`coalesce(${t.orgUnitId}, '00000000-0000-0000-0000-000000000000')`,
    ),
  ],
);

export type RoleAssignmentRow = typeof roleAssignments.$inferSelect;

export type RoleRow = typeof roles.$inferSelect;
