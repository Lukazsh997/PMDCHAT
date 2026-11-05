import type { PresenceStatus } from '@plataforma/contracts';
import type { Redis } from 'ioredis';

const TTL = 120;
const socketsKey = (u: string) => `presence:sockets:${u}`;
const statusKey = (u: string) => `presence:status:${u}`;
export const ONLINE_SET = 'presence:online';

/**
 * Presença compartilhada entre instâncias da API: cada conexão registra seu estado
 * no Valkey com expiração, renovada pelo heartbeat. Uma instância que cair deixa de
 * renovar e seus registros somem sozinhos em até 2 minutos.
 */
export class PresenceStore {
  constructor(private readonly redis: Redis) {}

  /** Grava o estado da conexão e devolve o estado agregado, se mudou. */
  async set(
    userId: string,
    socketId: string,
    status: 'online' | 'away',
  ): Promise<PresenceStatus | null> {
    await this.redis
      .multi()
      .hset(socketsKey(userId), socketId, status)
      .expire(socketsKey(userId), TTL)
      .exec();
    return this.recompute(userId);
  }

  async remove(userId: string, socketId: string): Promise<PresenceStatus | null> {
    await this.redis.hdel(socketsKey(userId), socketId);
    return this.recompute(userId);
  }

  async refresh(userId: string): Promise<void> {
    await this.redis.multi().expire(socketsKey(userId), TTL).expire(statusKey(userId), TTL).exec();
  }

  async statuses(userIds: string[]): Promise<Record<string, PresenceStatus>> {
    const out: Record<string, PresenceStatus> = {};
    const values = await Promise.all(userIds.map((u) => this.redis.hvals(socketsKey(u))));
    userIds.forEach((u, i) => (out[u] = aggregate(values[i]!)));
    return out;
  }

  private async recompute(userId: string): Promise<PresenceStatus | null> {
    const status = aggregate(await this.redis.hvals(socketsKey(userId)));
    const previous = await this.redis.getset(statusKey(userId), status);
    await this.redis.expire(statusKey(userId), TTL);
    if (status === 'offline') await this.redis.srem(ONLINE_SET, userId);
    else await this.redis.sadd(ONLINE_SET, userId);
    return previous === status ? null : status;
  }
}

/**
 * Pessoas conectadas agora (disponíveis ou ausentes). Confere a chave de estado de
 * cada uma: se uma instância da API caiu, o registro dela expira e não é contado.
 */
export async function connectedUserIds(redis: Redis): Promise<string[]> {
  const ids = await redis.smembers(ONLINE_SET);
  if (!ids.length) return [];
  const states = await redis.mget(ids.map(statusKey));
  return ids.filter((_, i) => states[i] === 'online' || states[i] === 'away');
}

function aggregate(values: string[]): PresenceStatus {
  if (values.includes('online')) return 'online';
  return values.length ? 'away' : 'offline';
}
