import { Inject, Injectable } from '@nestjs/common';
import {
  SEARCH_MARK,
  type SearchFileHit,
  type SearchMessagesPage,
  type searchFilesSchema,
  type searchMessagesSchema,
} from '@plataforma/contracts';
import { inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DB, type Database } from '../../database/database.js';
import { files, messages } from '../../database/schema/index.js';
import { toUploaded } from '../files/index.js';
import { MessagesService } from './messages.service.js';

type MessagesQuery = z.output<typeof searchMessagesSchema>;
type FilesQuery = z.output<typeof searchFilesSchema>;

/**
 * Transforma o que a pessoa digitou numa consulta do PostgreSQL: cada palavra vira
 * prefixo ("edit" encontra "edital") e todas precisam aparecer. A configuração
 * pt_unaccent ignora acentos e reduz as palavras ao radical em português.
 */
export function toPrefixQuery(q: string): string | null {
  const words = q
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

const HEADLINE = `StartSel="${SEARCH_MARK.start}", StopSel="${SEARCH_MARK.end}", MaxWords=28, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "`;

/** Nome da conversa como quem busca a vê (diretas: o nome da outra pessoa). */
const titleSql = (me: string) => sql`
  case when c.type = 'direct' then (
    select u.display_name from conversation_members x join users u on u.id = x.user_id
     where x.conversation_id = c.id and x.user_id <> ${me} limit 1)
  else c.name end`;

/**
 * Busca em tudo o que a pessoa pode ler: só conversas de que participa, só a partir
 * de quando entrou, nunca mensagens apagadas.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly messages: MessagesService,
  ) {}

  async searchMessages(userId: string, q: MessagesQuery): Promise<SearchMessagesPage> {
    const tsq = toPrefixQuery(q.q);
    if (!tsq) return { items: [], hasMore: false };
    const filters = [
      q.conversationId ? sql`and m.conversation_id = ${q.conversationId}` : sql``,
      q.senderId ? sql`and m.sender_id = ${q.senderId}` : sql``,
      q.from ? sql`and m.created_at >= ${q.from}::date` : sql``,
      q.to ? sql`and m.created_at < ${q.to}::date + 1` : sql``,
      q.withFiles
        ? sql`and exists (select 1 from message_attachments a where a.message_id = m.id)`
        : sql``,
      q.before ? sql`and m.created_at < ${new Date(q.before).toISOString()}::timestamptz` : sql``,
    ];
    const rows = (await this.db.execute(sql`
      select m.id, c.id as conversation_id, c.type, ${titleSql(userId)} as title,
             s.display_name as sender_name,
             ts_headline('pt_unaccent', m.body, query, ${HEADLINE}) as snippet
        from messages m
        join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId}
        join conversations c on c.id = m.conversation_id
        left join users s on s.id = m.sender_id,
             to_tsquery('pt_unaccent', ${tsq}) query
       where m.body_tsv @@ query
         and m.seq > cm.joined_seq and m.deleted_at is null and m.type = 'text'
         ${sql.join(filters, sql` `)}
       order by m.created_at desc
       limit ${q.limit + 1}
    `)) as unknown as {
      id: string;
      conversation_id: string;
      type: 'direct' | 'group';
      title: string | null;
      sender_name: string | null;
      snippet: string;
    }[];
    const page = rows.slice(0, q.limit);
    const full = page.length
      ? await this.db
          .select()
          .from(messages)
          .where(
            inArray(
              messages.id,
              page.map((r) => r.id),
            ),
          )
      : [];
    const byId = new Map((await this.messages.withAttachments(full)).map((m) => [m.id, m]));
    return {
      items: page.map((r) => ({
        message: byId.get(r.id)!,
        conversation: { id: r.conversation_id, type: r.type, title: r.title ?? 'Conversa' },
        senderName: r.sender_name ?? 'Alguém',
        snippet: r.snippet,
      })),
      hasMore: rows.length > q.limit,
    };
  }

  /** Arquivos enviados nas conversas da pessoa, pelo nome (sem acento, qualquer parte). */
  async searchFiles(userId: string, q: FilesQuery): Promise<SearchFileHit[]> {
    const term = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = (await this.db.execute(sql`
      select distinct on (f.id) f.id as file_id, m.id as message_id, m.seq,
             m.created_at, c.id as conversation_id, c.type, ${titleSql(userId)} as title,
             s.display_name as sender_name
        from files f
        join message_attachments a on a.file_id = f.id
        join messages m on m.id = a.message_id
        join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId}
        join conversations c on c.id = m.conversation_id
        left join users s on s.id = m.sender_id
       where unaccent(f.original_name) ilike unaccent(${term})
         and m.seq > cm.joined_seq and m.deleted_at is null
         ${q.conversationId ? sql`and m.conversation_id = ${q.conversationId}` : sql``}
       order by f.id, m.created_at desc
    `)) as unknown as {
      file_id: string;
      message_id: string;
      seq: string;
      created_at: Date;
      conversation_id: string;
      type: 'direct' | 'group';
      title: string | null;
      sender_name: string | null;
    }[];
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const top = rows.slice(0, q.limit);
    const fileRows = top.length
      ? await this.db
          .select()
          .from(files)
          .where(
            inArray(
              files.id,
              top.map((r) => r.file_id),
            ),
          )
      : [];
    const byId = new Map(fileRows.map((f) => [f.id, toUploaded(f)]));
    return top.map((r) => ({
      file: byId.get(r.file_id)!,
      messageId: r.message_id,
      seq: Number(r.seq),
      conversation: { id: r.conversation_id, type: r.type, title: r.title ?? 'Conversa' },
      senderName: r.sender_name ?? 'Alguém',
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
