import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';

/**
 * Árvore organizacional (órgão → secretaria → subsecretaria → setor…).
 * `path` é o caminho materializado `/<id-raiz>/…/<id>/`: buscar descendentes é um
 * `LIKE 'prefixo%'` indexado, sem extensões do PostgreSQL (ver ADR 0006).
 */
export const orgUnits = pgTable(
  'org_units',
  {
    id: id(),
    parentId: uuid().references((): AnyPgColumn => orgUnits.id, { onDelete: 'restrict' }),
    kind: varchar({ length: 32 }).notNull(),
    name: varchar({ length: 160 }).notNull(),
    acronym: varchar({ length: 24 }),
    path: text().notNull(),
    depth: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('org_units_parent_name_uq').on(
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000')`,
      sql`lower(${t.name})`,
    ),
    index('org_units_path_idx').on(sql`${t.path} text_pattern_ops`),
  ],
);

export type OrgUnitRow = typeof orgUnits.$inferSelect;
