import { Inject, Injectable } from '@nestjs/common';
import type { AdminStats, AuditPage } from '@plataforma/contracts';
import { and, count, desc, eq, gte, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DB, type Database } from '../../database/database.js';
import {
  auditLogs,
  conversations,
  messages,
  orgUnits,
  users,
} from '../../database/schema/index.js';
import { REDIS } from '../../redis/redis.module.js';
import { connectedUserIds } from '../realtime/index.js';

@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list(f: {
    action?: string;
    actorId?: string;
    entityId?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }): Promise<AuditPage> {
    const c: SQL[] = [];
    if (f.action) c.push(sql`${auditLogs.action} like ${f.action.replace(/[%_]/g, '') + '%'}`);
    if (f.actorId) c.push(eq(auditLogs.actorId, f.actorId));
    if (f.entityId) c.push(eq(auditLogs.entityId, f.entityId));
    if (f.from) c.push(gte(auditLogs.createdAt, new Date(f.from)));
    if (f.to) c.push(lte(auditLogs.createdAt, new Date(f.to)));
    const where = c.length ? and(...c) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          log: auditLogs,
          actor: { id: users.id, displayName: users.displayName, username: users.username },
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(f.pageSize)
        .offset((f.page - 1) * f.pageSize),
      this.db.select({ n: count() }).from(auditLogs).where(where),
    ]);
    return {
      total: total?.n ?? 0,
      items: rows.map((r) => ({
        id: r.log.id,
        action: r.log.action,
        actor: r.actor?.id ? r.actor : null,
        entityType: r.log.entityType,
        entityId: r.log.entityId,
        ip: r.log.ip,
        metadata: r.log.metadata ?? null,
        createdAt: r.log.createdAt.toISOString(),
      })),
    };
  }

  async stats(): Promise<AdminStats> {
    const active = and(isNull(users.deletedAt), eq(users.status, 'active'));
    const [[a], [g], [b], [u], [c], [m], online] = await Promise.all([
      this.db.select({ n: count() }).from(users).where(active),
      this.db
        .select({ n: count() })
        .from(users)
        .where(and(active, eq(users.kind, 'guest'))),
      this.db
        .select({ n: count() })
        .from(users)
        .where(and(isNull(users.deletedAt), eq(users.status, 'blocked'))),
      this.db.select({ n: count() }).from(orgUnits),
      this.db.select({ n: count() }).from(conversations),
      this.db
        .select({ n: count() })
        .from(messages)
        .where(gte(messages.createdAt, new Date(Date.now() - 86_400_000))),
      connectedUserIds(this.redis).then((ids) => ids.length),
    ]);
    return {
      activeUsers: a?.n ?? 0,
      guests: g?.n ?? 0,
      blockedUsers: b?.n ?? 0,
      orgUnits: u?.n ?? 0,
      conversations: c?.n ?? 0,
      messagesLast24h: m?.n ?? 0,
      onlineNow: online,
    };
  }
}
