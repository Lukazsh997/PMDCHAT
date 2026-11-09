import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';
import { sessions } from './sessions.js';
import { users } from './users.js';

/**
 * Inscrições de Web Push: uma por navegador. Ligada à sessão para sair junto com
 * ela (logout, sessão encerrada no painel).
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid().references(() => sessions.id, { onDelete: 'cascade' }),
    endpoint: text().notNull(),
    p256dh: varchar({ length: 255 }).notNull(),
    auth: varchar({ length: 255 }).notNull(),
    userAgent: varchar({ length: 512 }),
    createdAt: createdAt(),
    lastSuccessAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);

/** Configurações guardadas no banco (ex.: chaves VAPID geradas na primeira subida). */
export const systemSettings = pgTable('system_settings', {
  key: varchar({ length: 64 }).primaryKey(),
  value: jsonb().notNull(),
  updatedAt: updatedAt(),
});

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
