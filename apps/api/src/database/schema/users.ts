import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_common.js';

export const userStatus = pgEnum('user_status', ['active', 'blocked', 'disabled']);
export const authSource = pgEnum('auth_source', ['local', 'ldap']);

export const users = pgTable(
  'users',
  {
    id: id(),
    username: varchar({ length: 64 }).notNull(),
    displayName: varchar({ length: 160 }).notNull(),
    email: varchar({ length: 254 }),
    jobTitle: varchar({ length: 160 }),
    status: userStatus().notNull().default('active'),
    authSource: authSource().notNull().default('local'),
    /** objectGUID do Active Directory (fase 3). */
    externalId: varchar({ length: 128 }),
    /**
     * Provisório até o módulo RBAC (fase 1): concede acesso administrativo total.
     * Será substituído por uma atribuição do papel "Super administrador".
     */
    isSuperAdmin: boolean().notNull().default(false),
    mustChangePassword: boolean().notNull().default(false),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username),
    uniqueIndex('users_email_uq')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    uniqueIndex('users_external_id_uq')
      .on(t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

/** Credenciais em tabela separada para limitar a exposição de hashes. */
export const userCredentials = pgTable('user_credentials', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text().notNull(),
  passwordChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  failedAttempts: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
  updatedAt: updatedAt(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserCredentialsRow = typeof userCredentials.$inferSelect;
