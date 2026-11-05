import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common.js';
import { users } from './users.js';

export const files = pgTable(
  'files',
  {
    id: id(),
    uploaderId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Caminho relativo dentro de FILES_DIR. */
    storageKey: varchar({ length: 255 }).notNull(),
    thumbnailKey: varchar({ length: 255 }),
    originalName: varchar({ length: 255 }).notNull(),
    mimeType: varchar({ length: 127 }).notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    sha256: varchar({ length: 64 }).notNull(),
    isImage: boolean().notNull().default(false),
    width: integer(),
    height: integer(),
    /** clean = verificado pelo antivírus; skipped = antivírus desativado na instalação. */
    scanStatus: varchar({ length: 16 }).notNull(),
    createdAt: createdAt(),
    /** Preenchido quando o arquivo é anexado a uma mensagem. */
    attachedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('files_uploader_idx').on(t.uploaderId),
    index('files_orphan_idx').on(t.attachedAt, t.createdAt),
  ],
);

export type FileRow = typeof files.$inferSelect;
