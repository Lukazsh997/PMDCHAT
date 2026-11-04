import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { HealthResponse } from '@plataforma/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { Public } from '../../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { DB, type Database } from '../../database/database.js';
import { REDIS } from '../../redis/redis.module.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** O processo está de pé (usado pelo Docker para reiniciar contêineres travados). */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** O processo e suas dependências estão prontos para atender. */
  @Get()
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const [database, valkey] = await Promise.all([
      probe(() => this.db.execute(sql`select 1`)),
      probe(() => this.redis.ping()),
    ]);
    const checks = { database, valkey };
    const healthy = Object.values(checks).every((c) => c.status === 'ok');
    if (!healthy) void reply.status(503);
    return {
      status: healthy ? 'ok' : 'down',
      version: this.config.APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}

async function probe(fn: () => Promise<unknown>): Promise<HealthResponse['checks'][string]> {
  const start = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : String(err) };
  }
}
