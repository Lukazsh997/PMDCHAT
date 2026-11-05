import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { SystemEvent } from '@plataforma/contracts';
import { createdAt, id, updatedAt } from './_common.js';
import { files } from './files.js';
import { orgUnits } from './org.js';
import { users } from './users.js';

export const conversationType = pgEnum('conversation_type', ['direct', 'group']);
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member']);
export const messageType = pgEnum('message_type', ['text', 'system']);
export const notificationLevel = pgEnum('notification_level', ['all', 'mentions', 'none']);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    type: conversationType().notNull(),
    name: varchar({ length: 120 }),
    description: varchar({ length: 500 }),
    /** Conversa direta: os dois ids em ordem, garante uma única conversa por par. */
    directKey: varchar({ length: 80 }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Canal de avisos: só os administradores do canal publicam. */
    isChannel: boolean().notNull().default(false),
    /** Canal ligado a uma unidade: as pessoas lotadas entram e saem sozinhas. */
    orgUnitId: uuid().references((): AnyPgColumn => orgUnits.id, { onDelete: 'set null' }),
    includeSubunits: boolean().notNull().default(true),
    /** Último número de sequência usado; incrementado a cada mensagem. */
    lastSeq: bigint({ mode: 'number' }).notNull().default(0),
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('conversations_direct_key_uq')
      .on(t.directKey)
      .where(sql`${t.directKey} is not null`),
  ],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole().notNull().default('member'),
    lastReadSeq: bigint({ mode: 'number' }).notNull().default(0),
    mutedUntil: timestamp({ withTimezone: true }),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Primeira mensagem visível ao membro (quem entra depois não vê o histórico anterior). */
    joinedSeq: bigint({ mode: 'number' }).notNull().default(0),
    /** Entrou pela lotação (canal de unidade): a sincronização põe e tira. */
    autoJoined: boolean().notNull().default(false),
    /** Quando avisar. Vazio = padrão (todas; em grupos com mais de 50 pessoas, só menções). */
    notificationLevel: notificationLevel(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('conversation_members_user_idx').on(t.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    seq: bigint({ mode: 'number' }).notNull(),
    senderId: uuid().references(() => users.id, { onDelete: 'set null' }),
    type: messageType().notNull().default('text'),
    body: text().notNull().default(''),
    system: jsonb().$type<SystemEvent>(),
    /** Gerado pelo navegador: torna o envio idempotente em caso de reenvio. */
    clientId: varchar({ length: 64 }),
    createdAt: createdAt(),
    editedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Conteúdo removido definitivamente (48 h após a exclusão). */
    purgedAt: timestamp({ withTimezone: true }),
    /** Mensagem entregue por um comunicado em massa. */
    broadcastId: uuid().references((): AnyPgColumn => broadcasts.id, { onDelete: 'set null' }),
    /** @todos: menciona todos os membros da conversa. */
    mentionsAll: boolean().notNull().default(false),
    // body_tsv (tsvector gerado, configuração pt_unaccent) existe só no banco: ver a
    // migração 0006. As consultas de busca usam SQL direto.
  },
  (t) => [
    uniqueIndex('messages_conversation_seq_uq').on(t.conversationId, t.seq),
    uniqueIndex('messages_client_id_uq')
      .on(t.conversationId, t.senderId, t.clientId)
      .where(sql`${t.clientId} is not null`),
    index('messages_pending_purge_idx')
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null and ${t.purgedAt} is null`),
  ],
);

/** Comunicados em massa: um registro por envio; cada destinatário recebe uma mensagem direta. */
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: id(),
    senderId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Primeiro setor escolhido (o detalhe completo fica na auditoria). */
    orgUnitId: uuid().references(() => orgUnits.id, { onDelete: 'set null' }),
    /**
     * Para quem foi, como aparece no balão ("SEAD e subunidades, DCA e 3 pessoas"),
     * fixado no envio: a unidade pode ser renomeada depois.
     */
    label: varchar('unit_name', { length: 200 }).notNull(),
    /** Algum setor foi escolhido com as subunidades. */
    includeSubunits: boolean().notNull(),
    body: text().notNull().default(''),
    recipientCount: integer().notNull(),
    clientId: varchar({ length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('broadcasts_client_id_uq').on(t.senderId, t.clientId),
    index('broadcasts_unit_idx').on(t.orgUnitId),
  ],
);

/** Reações: uma linha por pessoa e emoji. */
export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: varchar({ length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/** Menções a pessoas (o @todos fica em `messages.mentions_all`). Alimenta a aba Menções. */
export const messageMentions = pgTable(
  'message_mentions',
  {
    messageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('message_mentions_user_idx').on(t.userId),
  ],
);

/** Histórico de edições, preservado para auditoria. */
export const messageEdits = pgTable(
  'message_edits',
  {
    id: id(),
    messageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    previousBody: text().notNull(),
    editedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    editedAt: createdAt(),
  },
  (t) => [index('message_edits_message_idx').on(t.messageId)],
);

export const messageAttachments = pgTable(
  'message_attachments',
  {
    messageId: uuid()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    fileId: uuid()
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.fileId] }),
    index('message_attachments_file_idx').on(t.fileId),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMemberRow = typeof conversationMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type BroadcastRow = typeof broadcasts.$inferSelect;
