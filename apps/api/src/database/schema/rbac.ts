import { index, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id } from './_common.js';
import { orgUnits } from './org.js';
import { users } from './users.js';

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
    role: varchar({ length: 32 }).notNull(),
    orgUnitId: uuid().references(() => orgUnits.id, { onDelete: 'cascade' }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
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
