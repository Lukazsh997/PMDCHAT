import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { users } from './users.js';

export const conversationType = pgEnum('conversation_type', ['direct', 'group']);
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member']);
export const messageType = pgEnum('message_type', ['text', 'system']);

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
