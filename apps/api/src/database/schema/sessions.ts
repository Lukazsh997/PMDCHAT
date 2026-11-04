import { index, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common.js';
import { users } from './users.js';

export const deviceType = pgEnum('device_type', ['web', 'desktop']);

/**
 * Espelho persistente das sessões. A validação de cada requisição usa o Valkey;
 * esta tabela alimenta o painel "meus dispositivos" e a auditoria.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 do token do cookie: o token em si nunca é armazenado. */
    tokenHash: varchar({ length: 64 }).notNull().unique(),
    deviceType: deviceType().notNull().default('web'),
    ip: varchar({ length: 45 }),
    userAgent: varchar({ length: 512 }),
    createdAt: createdAt(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: varchar({ length: 32 }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export type SessionRow = typeof sessions.$inferSelect;
