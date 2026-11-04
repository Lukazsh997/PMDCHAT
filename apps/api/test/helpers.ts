import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_PREFIX } from '@plataforma/contracts';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { createApp } from '../src/bootstrap.js';
import { DB, type Database } from '../src/database/database.js';
import { PasswordService } from '../src/modules/auth/index.js';
import { UsersService } from '../src/modules/users/index.js';
import { REDIS } from '../src/redis/redis.module.js';

export interface TestContext {
  app: NestFastifyApplication;
  db: Database;
  redis: Redis;
  users: UsersService;
  passwords: PasswordService;
}

export async function startTestApp(): Promise<TestContext> {
  const app = await createApp({ logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    db: app.get<Database>(DB),
    redis: app.get<Redis>(REDIS),
    users: app.get(UsersService),
    passwords: app.get(PasswordService),
  };
}

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.db.execute(sql`truncate users, user_credentials, sessions, audit_logs cascade`);
  await ctx.redis.flushdb();
}

export async function createUser(
  ctx: TestContext,
  overrides: Partial<{ username: string; password: string; mustChangePassword: boolean }> = {},
) {
  const password = overrides.password ?? 'senhaSegura2026';
  const user = await ctx.users.create({
    username: overrides.username ?? 'maria.silva',
    displayName: 'Maria Silva',
    passwordHash: await ctx.passwords.hash(password),
    mustChangePassword: overrides.mustChangePassword ?? false,
  });
  return { user, password };
}

type Method = 'GET' | 'POST' | 'DELETE';

export async function call(
  ctx: TestContext,
  method: Method,
  path: string,
  opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) {
  const res = await ctx.app.inject({
    method,
    url: `${API_PREFIX}${path}`,
    payload: opts.body as Record<string, unknown> | undefined,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
  });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as Record<string, any>) : undefined,
    setCookie: res.headers['set-cookie'],
    headers: res.headers,
  };
}

/** Faz login e devolve o cabeçalho `cookie` pronto para as próximas chamadas. */
export async function login(ctx: TestContext, username: string, password: string): Promise<string> {
  const res = await call(ctx, 'POST', '/auth/login', { body: { username, password } });
  if (res.status !== 200)
    throw new Error(`login falhou: ${res.status} ${JSON.stringify(res.body)}`);
  const raw = Array.isArray(res.setCookie) ? res.setCookie[0] : res.setCookie;
  return String(raw).split(';')[0]!;
}
