import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_PREFIX, type RoleKey } from '@plataforma/contracts';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import { createApp } from '../src/bootstrap.js';
import { DB, type Database } from '../src/database/database.js';
import { orgUnits, roleAssignments } from '../src/database/schema/index.js';
import { MfaService, PasswordService } from '../src/modules/auth/index.js';
import { UsersService } from '../src/modules/users/index.js';
import { REDIS } from '../src/redis/redis.module.js';

export interface TestContext {
  app: NestFastifyApplication;
  db: Database;
  redis: Redis;
  users: UsersService;
  passwords: PasswordService;
  mfa: MfaService;
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
    mfa: app.get(MfaService),
  };
}

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.db.execute(sql`
    truncate users, user_credentials, sessions, audit_logs, org_units, role_assignments,
             conversations, conversation_members, messages, message_edits, message_attachments, files,
             message_reactions, message_mentions, push_subscriptions,
             broadcasts cascade`);
  // Papéis criados nos testes saem; os de sistema (da migração) ficam.
  await ctx.db.execute(sql`delete from roles where not is_system`);
  await ctx.redis.flushdb();
}

export interface UserOptions {
  username?: string;
  displayName?: string;
  password?: string;
  mustChangePassword?: boolean;
  orgUnitId?: string | null;
  kind?: 'member' | 'guest';
  accessExpiresAt?: Date | null;
  role?: RoleKey;
  roleUnitId?: string;
  /** Ativa o MFA e devolve o segredo para gerar códigos. */
  mfa?: boolean;
}

export async function createUser(ctx: TestContext, o: UserOptions = {}) {
  const password = o.password ?? 'senhaSegura2026';
  const username = o.username ?? 'maria.silva';
  const user = await ctx.users.create({
    username,
    displayName: o.displayName ?? 'Maria Silva',
    passwordHash: await ctx.passwords.hash(password),
    mustChangePassword: o.mustChangePassword ?? false,
    orgUnitId: o.orgUnitId ?? null,
    kind: o.kind ?? 'member',
    accessExpiresAt: o.accessExpiresAt ?? null,
  });
  if (o.role) {
    await ctx.db
      .insert(roleAssignments)
      .values({ userId: user.id, role: o.role, orgUnitId: o.roleUnitId ?? null });
  }
  let mfaSecret: string | undefined;
  if (o.mfa) {
    const setup = await ctx.mfa.startSetup(user.id, username);
    mfaSecret = setup.secret;
    const sealed = await ctx.mfa.finishSetup(user.id, username, totp(setup.secret));
    await ctx.users.setMfa(user.id, sealed);
  }
  return { user, password, mfaSecret };
}

export function totp(secret: string): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
}

export async function createUnit(
  ctx: TestContext,
  name: string,
  parent?: { id: string; path: string; depth: number },
) {
  const id = crypto.randomUUID();
  const [row] = await ctx.db
    .insert(orgUnits)
    .values({
      id,
      name,
      kind: 'setor',
      parentId: parent?.id ?? null,
      path: `${parent?.path ?? '/'}${id}/`,
      depth: parent ? parent.depth + 1 : 0,
    })
    .returning();
  return row!;
}

type Method = 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';

export async function call(
  ctx: TestContext,
  method: Method,
  path: string,
  opts: {
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
    payload?: Buffer | string;
  } = {},
) {
  const res = await ctx.app.inject({
    method,
    url: `${API_PREFIX}${path}`,
    payload: (opts.payload ?? opts.body) as Record<string, unknown> | undefined,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
  });
  let body: Record<string, any> | undefined;
  try {
    body = res.body ? (JSON.parse(res.body) as Record<string, any>) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: res.statusCode,
    body,
    raw: res.rawPayload,
    setCookie: res.headers['set-cookie'],
    headers: res.headers,
  };
}

/** Faz login (com o código do MFA se houver) e devolve o cabeçalho `cookie`. */
export async function login(
  ctx: TestContext,
  username: string,
  password: string,
  mfaSecret?: string,
): Promise<string> {
  let res = await call(ctx, 'POST', '/auth/login', { body: { username, password } });
  if (res.status === 200 && res.body?.mfaRequired) {
    res = await call(ctx, 'POST', '/auth/login/mfa', {
      body: { challengeId: res.body.challengeId, code: totp(mfaSecret!) },
    });
  }
  if (res.status !== 200)
    throw new Error(`login falhou: ${res.status} ${JSON.stringify(res.body)}`);
  const raw = Array.isArray(res.setCookie) ? res.setCookie[0] : res.setCookie;
  return String(raw).split(';')[0]!;
}

/** Cria um usuário e já devolve a sessão. */
export async function signedIn(ctx: TestContext, o: UserOptions = {}) {
  const created = await createUser(ctx, o);
  const cookie = await login(ctx, o.username ?? 'maria.silva', created.password, created.mfaSecret);
  return { ...created, cookie };
}

/** Corpo multipart com um arquivo, para testar uploads. */
export function multipart(name: string, content: Buffer, type = 'application/octet-stream') {
  const boundary = '----teste' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
