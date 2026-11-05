import {
  boolean,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { LdapSyncSummary } from '@plataforma/contracts';
import { createdAt, id, updatedAt } from './_common.js';
import { orgUnits } from './org.js';
import { roles } from './rbac.js';
import { users } from './users.js';

/** Configuração do Active Directory: uma linha só (id = 1). */
export const ldapSettings = pgTable('ldap_settings', {
  id: smallint().primaryKey().default(1),
  enabled: boolean().notNull().default(false),
  url: text().notNull().default(''),
  startTls: boolean().notNull().default(false),
  tlsVerify: boolean().notNull().default(true),
  caCert: text(),
  bindDn: text().notNull().default(''),
  /** Senha da conta de serviço, cifrada com APP_SECRET (AES-256-GCM). */
  bindPasswordEnc: text(),
  baseDn: text().notNull().default(''),
  userFilter: text().notNull(),
  usernameAttribute: varchar({ length: 64 }).notNull(),
  displayNameAttribute: varchar({ length: 64 }).notNull(),
  emailAttribute: varchar({ length: 64 }).notNull(),
  jobTitleAttribute: varchar({ length: 64 }).notNull(),
  defaultOrgUnitId: uuid().references(() => orgUnits.id, { onDelete: 'set null' }),
  autoProvision: boolean().notNull().default(true),
  syncIntervalMinutes: integer().notNull().default(60),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/** OU do AD → unidade do organograma. Vale para a OU e as de baixo sem mapeamento próprio. */
export const ldapOuMappings = pgTable('ldap_ou_mappings', {
  /** DN da OU em minúsculas (comparação do AD não diferencia maiúsculas). */
  dn: text().primaryKey(),
  orgUnitId: uuid()
    .notNull()
    .references(() => orgUnits.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

/** Grupo do AD → papel (com a unidade, para papéis com escopo). */
export const ldapGroupMappings = pgTable(
  'ldap_group_mappings',
  {
    id: id(),
    dn: text().notNull(),
    role: varchar({ length: 32 })
      .notNull()
      .references(() => roles.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    orgUnitId: uuid().references(() => orgUnits.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ldap_group_mappings_uq').on(t.dn, t.role, t.orgUnitId)],
);

/** Histórico das sincronizações. */
export const ldapSyncRuns = pgTable('ldap_sync_runs', {
  id: id(),
  trigger: varchar({ length: 16 }).notNull(),
  status: varchar({ length: 16 }).notNull(),
  startedAt: createdAt(),
  finishedAt: timestamp({ withTimezone: true }),
  summary: jsonb().$type<LdapSyncSummary>(),
  error: text(),
  actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
});
