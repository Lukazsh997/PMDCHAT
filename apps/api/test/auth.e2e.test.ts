import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs } from '../src/database/schema/index.js';
import { call, createUser, login, resetState, startTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await resetState(ctx);
});

describe('health', () => {
  it('informa banco e Valkey disponíveis', async () => {
    const res = await call(ctx, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'ok' }, valkey: { status: 'ok' } },
    });
  });
});

describe('login', () => {
  it('exige sessão nas rotas protegidas', async () => {
    const res = await call(ctx, 'GET', '/auth/me');
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe('UNAUTHENTICATED');
  });

  it('cria sessão com cookie HttpOnly e SameSite=Strict, sem Secure em HTTP', async () => {
    const { password } = await createUser(ctx);
    const res = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'Maria.Silva', password },
    });
    expect(res.status).toBe(200);
    expect(res.body?.user).toMatchObject({ username: 'maria.silva', displayName: 'Maria Silva' });
    expect(res.body?.user).not.toHaveProperty('passwordHash');

    const cookie = String(res.setCookie);
    expect(cookie).toMatch(/^plataforma_sid=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');

    const me = await call(ctx, 'GET', '/auth/me', { cookie: cookie.split(';')[0] });
    expect(me.status).toBe(200);
    expect(me.body?.user.username).toBe('maria.silva');
  });

  it('responde igual para usuário inexistente e senha errada', async () => {
    await createUser(ctx);
    const wrong = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria.silva', password: 'errada' },
    });
    const unknown = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'ninguem', password: 'errada' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body?.message).toBe(unknown.body?.message);
    expect(wrong.body?.code).toBe('INVALID_CREDENTIALS');
  });

  it('devolve erros de validação por campo', async () => {
    const res = await call(ctx, 'POST', '/auth/login', { body: { username: 'a b', password: '' } });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body?.fields ?? {})).toEqual(
      expect.arrayContaining(['username', 'password']),
    );
  });

  it('bloqueia a conta após 5 tentativas erradas, mesmo com a senha certa depois', async () => {
    const { password } = await createUser(ctx);
    for (let i = 0; i < 5; i++) {
      const r = await call(ctx, 'POST', '/auth/login', {
        body: { username: 'maria.silva', password: 'x' },
      });
      expect(r.status).toBe(401);
    }
    const res = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria.silva', password },
    });
    expect(res.status).toBe(423);
    expect(res.body?.code).toBe('ACCOUNT_LOCKED');

    const events = await ctx.db.select({ action: auditLogs.action }).from(auditLogs);
    expect(events.map((e) => e.action)).toContain('auth.account_locked');
  });

  it('recusa conta bloqueada pelo administrador', async () => {
    const { user, password } = await createUser(ctx);
    const { users } = await import('../src/database/schema/index.js');
    const { eq } = await import('drizzle-orm');
    await ctx.db.update(users).set({ status: 'blocked' }).where(eq(users.id, user.id));
    const res = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria.silva', password },
    });
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('ACCOUNT_INACTIVE');
  });

  it('limita tentativas de login por IP', async () => {
    let last = { status: 0 } as Awaited<ReturnType<typeof call>>;
    for (let i = 0; i < 31; i++) {
      last = await call(ctx, 'POST', '/auth/login', {
        body: { username: 'qualquer', password: 'x' },
      });
    }
    expect(last.status).toBe(429);
    expect(last.body?.code).toBe('RATE_LIMITED');
    expect(last.headers['retry-after']).toBeDefined();
  });
});

describe('proteção CSRF por origem', () => {
  it('recusa alteração vinda de origem não autorizada', async () => {
    const { password } = await createUser(ctx);
    const cookie = await login(ctx, 'maria.silva', password);
    const res = await call(ctx, 'POST', '/auth/logout', {
      cookie,
      headers: { origin: 'http://site-malicioso.test' },
    });
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('INVALID_ORIGIN');
  });

  it('aceita o próprio endereço do sistema sem configuração (IP, nome ou porta)', async () => {
    const { password } = await createUser(ctx);
    for (const host of ['192.168.0.10', 'chat.orgao.local', '10.0.0.5:8080']) {
      const res = await call(ctx, 'POST', '/auth/login', {
        body: { username: 'maria.silva', password },
        headers: { host, origin: `http://${host}` },
      });
      expect(res.status, host).toBe(200);
    }
  });

  it('recusa site de terceiros mesmo que aponte para o endereço do sistema', async () => {
    const res = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'x', password: 'y' },
      headers: { host: '192.168.0.10', origin: 'http://192.168.0.10.evil.test' },
    });
    expect(res.status).toBe(403);
  });

  it('aceita a origem configurada', async () => {
    const { password } = await createUser(ctx);
    const cookie = await login(ctx, 'maria.silva', password);
    const res = await call(ctx, 'POST', '/auth/logout', {
      cookie,
      headers: { origin: 'http://app.test' },
    });
    expect(res.status).toBe(204);
  });
});

describe('sessões', () => {
  it('logout encerra a sessão no servidor', async () => {
    const { password } = await createUser(ctx);
    const cookie = await login(ctx, 'maria.silva', password);
    expect((await call(ctx, 'POST', '/auth/logout', { cookie })).status).toBe(204);
    expect((await call(ctx, 'GET', '/auth/me', { cookie })).status).toBe(401);
  });

  it('lista os dispositivos e permite encerrar outro', async () => {
    const { password } = await createUser(ctx);
    const a = await login(ctx, 'maria.silva', password);
    const b = await login(ctx, 'maria.silva', password);

    const list = await call(ctx, 'GET', '/auth/sessions', { cookie: a });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    const other = (list.body as unknown as { id: string; current: boolean }[]).find(
      (s) => !s.current,
    )!;

    expect((await call(ctx, 'DELETE', `/auth/sessions/${other.id}`, { cookie: a })).status).toBe(
      204,
    );
    expect((await call(ctx, 'GET', '/auth/me', { cookie: b })).status).toBe(401);
    expect((await call(ctx, 'GET', '/auth/me', { cookie: a })).status).toBe(200);
  });
});

describe('troca de senha', () => {
  it('exige a troca antes de liberar o sistema', async () => {
    const { password } = await createUser(ctx, { mustChangePassword: true });
    const cookie = await login(ctx, 'maria.silva', password);

    const blocked = await call(ctx, 'GET', '/auth/sessions', { cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body?.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await call(ctx, 'GET', '/auth/me', { cookie });
    expect(me.body?.user.mustChangePassword).toBe(true);

    const changed = await call(ctx, 'POST', '/auth/password', {
      cookie,
      body: { currentPassword: password, newPassword: 'novaSenhaForte2026' },
    });
    expect(changed.status).toBe(204);
    expect((await call(ctx, 'GET', '/auth/sessions', { cookie })).status).toBe(200);
  });

  it('encerra as outras sessões e passa a aceitar só a senha nova', async () => {
    const { password } = await createUser(ctx);
    const a = await login(ctx, 'maria.silva', password);
    const b = await login(ctx, 'maria.silva', password);

    const res = await call(ctx, 'POST', '/auth/password', {
      cookie: a,
      body: { currentPassword: password, newPassword: 'novaSenhaForte2026' },
    });
    expect(res.status).toBe(204);
    expect((await call(ctx, 'GET', '/auth/me', { cookie: a })).status).toBe(200);
    expect((await call(ctx, 'GET', '/auth/me', { cookie: b })).status).toBe(401);

    const old = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria.silva', password },
    });
    expect(old.status).toBe(401);
    await login(ctx, 'maria.silva', 'novaSenhaForte2026');
  });

  it('recusa senha atual incorreta e senha nova fraca', async () => {
    const { password } = await createUser(ctx);
    const cookie = await login(ctx, 'maria.silva', password);
    const wrong = await call(ctx, 'POST', '/auth/password', {
      cookie,
      body: { currentPassword: 'errada', newPassword: 'novaSenhaForte2026' },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body?.fields?.currentPassword).toBeDefined();

    const weak = await call(ctx, 'POST', '/auth/password', {
      cookie,
      body: { currentPassword: password, newPassword: 'curta' },
    });
    expect(weak.status).toBe(400);
    expect(weak.body?.fields?.newPassword).toBeDefined();
  });
});
