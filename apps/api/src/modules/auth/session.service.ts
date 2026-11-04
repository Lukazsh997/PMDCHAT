import { Inject, Injectable } from '@nestjs/common';
import type { SessionDevice, SessionInfo } from '@plataforma/contracts';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { DB, type Database } from '../../database/database.js';
import { sessions } from '../../database/schema/index.js';
import { REDIS } from '../../redis/redis.module.js';
import type { ActiveSession } from './auth.types.js';

const TOUCH_INTERVAL_MS = 60_000;
const DB_TOUCH_INTERVAL_MS = 5 * 60_000;

const sessionKey = (tokenHash: string) => `sess:${tokenHash}`;
const userSessionsKey = (userId: string) => `user:${userId}:sessions`;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Sessões no servidor: o cookie carrega apenas um token aleatório; o Valkey guarda
 * o estado (expiração deslizante por inatividade + limite absoluto) e o PostgreSQL
 * mantém o histórico para o painel "meus dispositivos".
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async create(input: {
    userId: string;
    deviceType: SessionDevice;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; session: ActiveSession }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.SESSION_MAX_HOURS * 3_600_000);

    const [row] = await this.db
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash,
        deviceType: input.deviceType,
        ip: input.ip,
        userAgent: input.userAgent,
        expiresAt,
      })
      .returning({ id: sessions.id });
    if (!row) throw new Error('Falha ao criar sessão');

    const session: ActiveSession = {
      id: row.id,
      userId: input.userId,
      tokenHash,
      deviceType: input.deviceType,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      touchedAt: now.toISOString(),
      dbTouchedAt: now.toISOString(),
    };
    await this.redis
      .multi()
      .set(sessionKey(tokenHash), JSON.stringify(session), 'EX', this.ttlSeconds(session, now))
      .sadd(userSessionsKey(input.userId), tokenHash)
      .exec();
    return { token, session };
  }

  /** Valida o token do cookie e renova a expiração por inatividade. */
  async validate(token: string): Promise<ActiveSession | null> {
    if (!token || token.length > 128) return null;
    const tokenHash = hashToken(token);
    const raw = await this.redis.get(sessionKey(tokenHash));
    if (!raw) return null;

    const session = JSON.parse(raw) as ActiveSession;
    const now = new Date();
    if (new Date(session.expiresAt) <= now) {
      await this.revokeByHash(session.userId, tokenHash, 'expired');
      return null;
    }

    if (now.getTime() - new Date(session.touchedAt).getTime() > TOUCH_INTERVAL_MS) {
      session.touchedAt = now.toISOString();
      const updateDb =
        now.getTime() - new Date(session.dbTouchedAt).getTime() > DB_TOUCH_INTERVAL_MS;
      if (updateDb) session.dbTouchedAt = now.toISOString();
      await this.redis.set(
        sessionKey(tokenHash),
        JSON.stringify(session),
        'EX',
        this.ttlSeconds(session, now),
      );
      if (updateDb) {
        await this.db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, session.id));
      }
    }
    return session;
  }

  async revokeByHash(userId: string, tokenHash: string, reason: string): Promise<void> {
    await this.redis
      .multi()
      .del(sessionKey(tokenHash))
      .srem(userSessionsKey(userId), tokenHash)
      .exec();
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  /** Encerra uma sessão específica do próprio usuário. Retorna `false` se não existir. */
  async revokeById(userId: string, sessionId: string, reason: string): Promise<boolean> {
    const [row] = await this.db
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)),
      )
      .limit(1);
    if (!row) return false;
    await this.revokeByHash(userId, row.tokenHash, reason);
    return true;
  }

  /** Encerra todas as sessões do usuário, opcionalmente preservando a atual. */
  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptTokenHash?: string,
  ): Promise<number> {
    const hashes = await this.redis.smembers(userSessionsKey(userId));
    const targets = hashes.filter((h) => h !== exceptTokenHash);
    if (targets.length) {
      const multi = this.redis.multi();
      for (const h of targets) multi.del(sessionKey(h)).srem(userSessionsKey(userId), h);
      await multi.exec();
    }
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptTokenHash) conditions.push(ne(sessions.tokenHash, exceptTokenHash));
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(...conditions));
    return targets.length;
  }

  /** Sessões ativas do usuário. Sessões expiradas por inatividade são marcadas na hora. */
  async list(userId: string, currentTokenHash: string): Promise<SessionInfo[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(sessions.lastUsedAt);

    const alive = await Promise.all(rows.map((r) => this.redis.exists(sessionKey(r.tokenHash))));

    const result: SessionInfo[] = [];
    for (const [i, r] of rows.entries()) {
      if (!alive[i]) {
        await this.revokeByHash(userId, r.tokenHash, 'idle');
        continue;
      }
      result.push({
        id: r.id,
        deviceType: r.deviceType,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt.toISOString(),
        current: r.tokenHash === currentTokenHash,
      });
    }
    return result.reverse();
  }

  private ttlSeconds(session: ActiveSession, now: Date): number {
    const idle = this.config.SESSION_IDLE_MINUTES * 60;
    const untilAbsolute = Math.floor(
      (new Date(session.expiresAt).getTime() - now.getTime()) / 1000,
    );
    return Math.max(1, Math.min(idle, untilAbsolute));
  }
}
