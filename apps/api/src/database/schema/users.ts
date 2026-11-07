import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
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
import { orgUnits } from './org.js';

export const userStatus = pgEnum('user_status', ['active', 'blocked', 'disabled']);
export const authSource = pgEnum('auth_source', ['local', 'ldap']);
export const userKind = pgEnum('user_kind', ['member', 'guest']);

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
    /** DN da conta no AD, na última sincronização. */
    ldapDn: text(),
    /**
     * A sincronização desativou a conta (desativada ou apagada no AD). Só nesse caso a
     * sincronização reativa sozinha: bloqueio feito no painel não é desfeito pelo AD.
     */
    ldapDisabledAt: timestamp({ withTimezone: true }),
    kind: userKind().notNull().default('member'),
    /** Lotação principal. */
    orgUnitId: uuid().references(() => orgUnits.id, { onDelete: 'set null' }),
    /** Convidados: data em que o acesso expira. */
    accessExpiresAt: timestamp({ withTimezone: true }),
    mustChangePassword: boolean().notNull().default(false),
    lastLoginAt: timestamp({ withTimezone: true }),
    /** Foto de perfil: caminho relativo em FILES_DIR (avatars/…). */
    avatarKey: varchar({ length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username),
    uniqueIndex('users_email_uq')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    index('users_org_unit_idx').on(t.orgUnitId),
    index('users_name_trgm_idx').using('gin', sql`lower(${t.displayName}) gin_trgm_ops`),
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
  /** Segredo TOTP cifrado com APP_SECRET (AES-256-GCM). */
  mfaSecretEnc: text(),
  mfaEnabledAt: timestamp({ withTimezone: true }),
  updatedAt: updatedAt(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserCredentialsRow = typeof userCredentials.$inferSelect;
