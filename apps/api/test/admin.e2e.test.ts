import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createUnit,
  createUser,
  login,
  resetState,
  signedIn,
  startTestApp,
  type TestContext,
  totp,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => (ctx = await startTestApp()));
afterAll(async () => ctx.app.close());
beforeEach(async () => resetState(ctx));

const superAdmin = () =>
  signedIn(ctx, { username: 'chefe', displayName: 'Chefe Geral', role: 'super_admin', mfa: true });

describe('acesso ao painel', () => {
  it('usuário comum não acessa o painel', async () => {
    const { cookie } = await signedIn(ctx);
    const res = await call(ctx, 'GET', '/admin/users', { cookie });
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('FORBIDDEN');
  });

  it('administrador sem MFA é orientado a ativá-lo', async () => {
    const { cookie } = await signedIn(ctx, { username: 'chefe', role: 'super_admin' });
    const me = await call(ctx, 'GET', '/auth/me', { cookie });
    expect(me.body?.mfaSetupRequired).toBe(true);
    expect(me.body?.permissions).toContain('admin.access');
    const res = await call(ctx, 'GET', '/admin/users', { cookie });
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('MFA_REQUIRED');
  });
});

describe('gestão de usuários', () => {
  it('cria usuário com senha temporária e troca obrigatória', async () => {
    const { cookie } = await superAdmin();
    const unit = await createUnit(ctx, 'Secretaria de Saúde');
    const res = await call(ctx, 'POST', '/admin/users', {
      cookie,
      body: {
        username: 'Joao.Souza',
        displayName: 'João Souza',
        orgUnitId: unit.id,
        email: 'joao@orgao.gov.br',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body?.user).toMatchObject({
      username: 'joao.souza',
      mustChangePassword: true,
      orgUnit: { name: 'Secretaria de Saúde' },
    });
    expect(res.body?.temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    const joao = await login(ctx, 'joao.souza', res.body!.temporaryPassword);
    const me = await call(ctx, 'GET', '/auth/me', { cookie: joao });
    expect(me.body?.user.mustChangePassword).toBe(true);

    const dup = await call(ctx, 'POST', '/admin/users', {
      cookie,
      body: { username: 'joao.souza', displayName: 'Outro João', orgUnitId: null },
    });
    expect(dup.status).toBe(409);
    expect(dup.body?.fields?.username).toBeDefined();
  });

  it('convidado precisa de data de expiração e perde o acesso depois dela', async () => {
    const { cookie } = await superAdmin();
    const noDate = await call(ctx, 'POST', '/admin/users', {
      cookie,
      body: {
        username: 'consultor',
        displayName: 'Consultor Externo',
        orgUnitId: null,
        kind: 'guest',
      },
    });
    expect(noDate.status).toBe(400);
    expect(noDate.body?.fields?.accessExpiresAt).toBeDefined();

    await createUser(ctx, {
      username: 'antigo',
      kind: 'guest',
      accessExpiresAt: new Date(Date.now() - 1000),
    });
    const res = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'antigo', password: 'senhaSegura2026' },
    });
    expect(res.status).toBe(403);
    expect(res.body?.message).toMatch(/convidado/);
  });

  it('administrador de unidade só vê e altera pessoas da sua unidade e das de baixo', async () => {
    const saude = await createUnit(ctx, 'Saúde');
    const ubs = await createUnit(ctx, 'UBS Centro', saude);
    const educacao = await createUnit(ctx, 'Educação');
    await createUser(ctx, { username: 'ana', displayName: 'Ana UBS', orgUnitId: ubs.id });
    const { user: bruno } = await createUser(ctx, {
      username: 'bruno',
      displayName: 'Bruno Educação',
      orgUnitId: educacao.id,
    });
    const { cookie } = await signedIn(ctx, {
      username: 'gestor',
      displayName: 'Gestor Saúde',
      orgUnitId: saude.id,
      role: 'unit_admin',
      roleUnitId: saude.id,
      mfa: true,
    });

    const list = await call(ctx, 'GET', '/admin/users', { cookie });
    expect(list.body?.items.map((u: { username: string }) => u.username).sort()).toEqual([
      'ana',
      'gestor',
    ]);

    expect((await call(ctx, 'GET', `/admin/users/${bruno.id}`, { cookie })).status).toBe(404);
    expect(
      (
        await call(ctx, 'POST', `/admin/users/${bruno.id}/status`, {
          cookie,
          body: { status: 'blocked' },
        })
      ).status,
    ).toBe(404);

    const outside = await call(ctx, 'POST', '/admin/users', {
      cookie,
      body: { username: 'novo', displayName: 'Pessoa Nova', orgUnitId: educacao.id },
    });
    expect(outside.status).toBe(403);
    const inside = await call(ctx, 'POST', '/admin/users', {
      cookie,
      body: { username: 'novo', displayName: 'Pessoa Nova', orgUnitId: ubs.id },
    });
    expect(inside.status).toBe(201);

    // Não pode atribuir papéis nem gerenciar o organograma.
    expect(
      (
        await call(ctx, 'POST', `/admin/users/${bruno.id}/roles`, {
          cookie,
          body: { role: 'auditor' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(ctx, 'POST', '/org-units', {
          cookie,
          body: { parentId: null, kind: 'setor', name: 'X' },
        })
      ).status,
    ).toBe(403);
  });

  it('bloquear encerra as sessões na hora; desbloquear libera o login', async () => {
    const { cookie } = await superAdmin();
    const { user, password } = await createUser(ctx);
    const victim = await login(ctx, 'maria.silva', password);

    const blocked = await call(ctx, 'POST', `/admin/users/${user.id}/status`, {
      cookie,
      body: { status: 'blocked' },
    });
    expect(blocked.body?.status).toBe('blocked');
    expect((await call(ctx, 'GET', '/auth/me', { cookie: victim })).status).toBe(401);
    expect(
      (await call(ctx, 'POST', '/auth/login', { body: { username: 'maria.silva', password } }))
        .status,
    ).toBe(403);

    await call(ctx, 'POST', `/admin/users/${user.id}/status`, {
      cookie,
      body: { status: 'active' },
    });
    await login(ctx, 'maria.silva', password);
  });

  it('não permite bloquear a própria conta', async () => {
    const { cookie, user } = await superAdmin();
    const res = await call(ctx, 'POST', `/admin/users/${user.id}/status`, {
      cookie,
      body: { status: 'blocked' },
    });
    expect(res.status).toBe(409);
  });

  it('senha temporária pelo painel derruba as sessões e exige troca', async () => {
    const { cookie } = await superAdmin();
    const { user, password } = await createUser(ctx);
    const old = await login(ctx, 'maria.silva', password);
    const res = await call(ctx, 'POST', `/admin/users/${user.id}/reset-password`, { cookie });
    expect(res.status).toBe(200);
    expect((await call(ctx, 'GET', '/auth/me', { cookie: old })).status).toBe(401);
    const fresh = await login(ctx, 'maria.silva', res.body!.temporaryPassword);
    expect(
      (await call(ctx, 'GET', '/auth/me', { cookie: fresh })).body?.user.mustChangePassword,
    ).toBe(true);
  });
});

describe('papéis', () => {
  it('atribui papel com escopo e impede remover o último super administrador', async () => {
    const { cookie, user: me } = await superAdmin();
    const unit = await createUnit(ctx, 'Obras');
    const { user } = await createUser(ctx);

    const noUnit = await call(ctx, 'POST', `/admin/users/${user.id}/roles`, {
      cookie,
      body: { role: 'unit_admin' },
    });
    expect(noUnit.status).toBe(400);
    const ok = await call(ctx, 'POST', `/admin/users/${user.id}/roles`, {
      cookie,
      body: { role: 'unit_admin', orgUnitId: unit.id },
    });
    expect(ok.body?.roles).toEqual([
      expect.objectContaining({
        role: 'unit_admin',
        orgUnit: expect.objectContaining({ name: 'Obras' }),
      }),
    ]);

    const mine = await call(ctx, 'GET', `/admin/users/${me.id}`, { cookie });
    const last = await call(
      ctx,
      'DELETE',
      `/admin/users/${me.id}/roles/${mine.body!.roles[0].id}`,
      { cookie },
    );
    expect(last.status).toBe(409);
  });
});

describe('organograma', () => {
  it('cria a árvore, move uma unidade com as subordinadas e protege exclusões', async () => {
    const { cookie } = await superAdmin();
    const post = (body: object) => call(ctx, 'POST', '/org-units', { cookie, body });
    const sec = (
      await post({
        parentId: null,
        kind: 'secretaria',
        name: 'Secretaria de Administração',
        acronym: 'SEAD',
      })
    ).body!;
    const sub = (
      await post({ parentId: sec.id, kind: 'subsecretaria', name: 'Subsecretaria de Pessoal' })
    ).body!;
    const setor = (await post({ parentId: sub.id, kind: 'setor', name: 'Folha de Pagamento' }))
      .body!;
    const outra = (
      await post({ parentId: null, kind: 'secretaria', name: 'Secretaria de Finanças' })
    ).body!;

    expect(
      (await post({ parentId: sec.id, kind: 'setor', name: 'subsecretaria de pessoal' })).status,
    ).toBe(409);

    const loop = await call(ctx, 'PATCH', `/org-units/${sec.id}`, {
      cookie,
      body: { parentId: setor.id },
    });
    expect(loop.status).toBe(400);

    const moved = await call(ctx, 'PATCH', `/org-units/${sub.id}`, {
      cookie,
      body: { parentId: outra.id },
    });
    expect(moved.body).toMatchObject({ parentId: outra.id, depth: 1 });
    const tree = (await call(ctx, 'GET', '/org-units', { cookie })).body as unknown as {
      name: string;
      depth: number;
    }[];
    expect(tree.map((u) => `${u.depth}:${u.name}`)).toEqual([
      '0:Secretaria de Administração',
      '0:Secretaria de Finanças',
      '1:Subsecretaria de Pessoal',
      '2:Folha de Pagamento',
    ]);

    // Administrador da secretaria de Finanças passa a alcançar o setor movido.
    await createUser(ctx, { username: 'folha', orgUnitId: setor.id });
    const g = await signedIn(ctx, {
      username: 'gestor.fin',
      orgUnitId: outra.id,
      role: 'unit_admin',
      roleUnitId: outra.id,
      mfa: true,
    });
    const seen = await call(ctx, 'GET', '/admin/users', { cookie: g.cookie });
    expect(seen.body?.items.map((u: { username: string }) => u.username)).toContain('folha');

    expect((await call(ctx, 'DELETE', `/org-units/${sub.id}`, { cookie })).status).toBe(409);
    expect((await call(ctx, 'DELETE', `/org-units/${setor.id}`, { cookie })).status).toBe(409);
  });
});

describe('auditoria', () => {
  it('registra as ações do painel e permite filtrar', async () => {
    const { cookie } = await superAdmin();
    await call(ctx, 'POST', '/admin/users', {
      cookie,
      body: { username: 'novo', displayName: 'Pessoa Nova', orgUnitId: null },
    });
    const res = await call(ctx, 'GET', '/admin/audit?action=user.', { cookie });
    expect(res.body?.items).toEqual([
      expect.objectContaining({
        action: 'user.created',
        actor: expect.objectContaining({ username: 'chefe' }),
      }),
    ]);
    const stats = await call(ctx, 'GET', '/admin/stats', { cookie });
    expect(stats.body).toMatchObject({ activeUsers: 2 });
  });
});

describe('verificação em duas etapas', () => {
  it('ativa com o código do aplicativo e passa a pedir o código no login', async () => {
    const { cookie, password } = await signedIn(ctx);
    const setup = await call(ctx, 'POST', '/auth/mfa/setup', { cookie });
    expect(setup.body?.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setup.body?.otpauthUrl).toContain('otpauth://totp/');

    expect(
      (await call(ctx, 'POST', '/auth/mfa/enable', { cookie, body: { code: '000000' } })).status,
    ).toBe(400);
    expect(
      (
        await call(ctx, 'POST', '/auth/mfa/enable', {
          cookie,
          body: { code: totp(setup.body!.secret) },
        })
      ).status,
    ).toBe(204);

    const step1 = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria.silva', password },
    });
    expect(step1.body).toMatchObject({ mfaRequired: true });
    expect(step1.setCookie).toBeUndefined();

    const wrong = await call(ctx, 'POST', '/auth/login/mfa', {
      body: { challengeId: step1.body!.challengeId, code: '123456' },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body?.code).toBe('MFA_INVALID');

    const ok = await call(ctx, 'POST', '/auth/login/mfa', {
      body: { challengeId: step1.body!.challengeId, code: totp(setup.body!.secret) },
    });
    expect(ok.status).toBe(200);
    expect(ok.body?.user.mfaEnabled).toBe(true);

    // O desafio vale uma vez só.
    const reuse = await call(ctx, 'POST', '/auth/login/mfa', {
      body: { challengeId: step1.body!.challengeId, code: totp(setup.body!.secret) },
    });
    expect(reuse.status).toBe(401);
  });

  it('descarta o desafio após 5 códigos errados', async () => {
    const { password } = await createUser(ctx, { mfa: true });
    const step1 = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria.silva', password },
    });
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (
          await call(ctx, 'POST', '/auth/login/mfa', {
            body: { challengeId: step1.body!.challengeId, code: '111111' },
          })
        ).status,
      );
    }
    expect(statuses).toEqual([400, 400, 400, 400, 401]);
  });

  it('administrador não pode desativar o próprio MFA; o super administrador pode redefinir o de outra pessoa', async () => {
    const admin = await superAdmin();
    expect(
      (
        await call(ctx, 'POST', '/auth/mfa/disable', {
          cookie: admin.cookie,
          body: { password: admin.password },
        })
      ).status,
    ).toBe(409);

    const { user, password, mfaSecret } = await createUser(ctx, { mfa: true });
    const victim = await login(ctx, 'maria.silva', password, mfaSecret);
    expect(
      (await call(ctx, 'POST', `/admin/users/${user.id}/reset-mfa`, { cookie: admin.cookie }))
        .status,
    ).toBe(204);
    expect((await call(ctx, 'GET', '/auth/me', { cookie: victim })).status).toBe(401);
    const res = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria.silva', password },
    });
    expect(res.body?.user.mfaEnabled).toBe(false);
  });
});
