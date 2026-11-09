import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createUnit,
  resetState,
  signedIn,
  startTestApp,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => (ctx = await startTestApp()));
afterAll(async () => ctx.app.close());
beforeEach(async () => resetState(ctx));

const admin = () => signedIn(ctx, { username: 'admin', role: 'super_admin', mfa: true });

describe('papéis editáveis', () => {
  it('lista os papéis de sistema; o super administrador não muda', async () => {
    const a = await admin();
    const list = await call(ctx, 'GET', '/admin/roles', { cookie: a.cookie });
    expect(list.body!.map((r: { key: string }) => r.key)).toEqual(
      ['super_admin', 'unit_admin', 'auditor', 'broadcaster'].sort((x, y) =>
        x === 'super_admin' ? -1 : y === 'super_admin' ? 1 : 0,
      ),
    );
    expect(list.body![0]).toMatchObject({ key: 'super_admin', locked: true, assignmentCount: 1 });
    expect(list.body![0].permissions).toContain('roles.manage');
    const locked = await call(ctx, 'PATCH', '/admin/roles/super_admin', {
      cookie: a.cookie,
      body: { permissions: ['audit.read'] },
    });
    expect(locked.status).toBe(409);
    expect((await call(ctx, 'DELETE', '/admin/roles/auditor', { cookie: a.cookie })).status).toBe(
      409,
    );
  });

  it('cria um papel, atribui, e a mudança de permissões vale na hora', async () => {
    const a = await admin();
    const unit = await createUnit(ctx, 'Ouvidoria');
    const created = await call(ctx, 'POST', '/admin/roles', {
      cookie: a.cookie,
      body: {
        name: 'Gestor de Ouvidoria',
        description: 'Cuida dos canais da ouvidoria',
        scoped: true,
        permissions: ['conversations.create_channel'],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'gestor_de_ouvidoria', isSystem: false });

    const ana = await signedIn(ctx, { username: 'ana', orgUnitId: unit.id });
    const assigned = await call(ctx, 'POST', `/admin/users/${ana.user.id}/roles`, {
      cookie: a.cookie,
      body: { role: 'gestor_de_ouvidoria', orgUnitId: unit.id },
    });
    expect(assigned.body!.roles).toEqual([
      expect.objectContaining({ role: 'gestor_de_ouvidoria', roleName: 'Gestor de Ouvidoria' }),
    ]);
    const me = await call(ctx, 'GET', '/auth/me', { cookie: ana.cookie });
    expect(me.body!.permissions).toEqual(['conversations.create_channel']);
    expect(
      (
        await call(ctx, 'POST', '/conversations/channel', {
          cookie: ana.cookie,
          body: { name: 'Ouvidoria informa', orgUnitId: unit.id },
        })
      ).status,
    ).toBe(201);

    // Tira a permissão: a próxima requisição já não pode.
    await call(ctx, 'PATCH', '/admin/roles/gestor_de_ouvidoria', {
      cookie: a.cookie,
      body: { permissions: ['broadcast.send'] },
    });
    expect(
      (
        await call(ctx, 'POST', '/conversations/channel', {
          cookie: ana.cookie,
          body: { name: 'De novo', orgUnitId: unit.id },
        })
      ).status,
    ).toBe(403);

    // Em uso: não troca o escopo nem é excluído.
    const scope = await call(ctx, 'PATCH', '/admin/roles/gestor_de_ouvidoria', {
      cookie: a.cookie,
      body: { scoped: false },
    });
    expect(scope.status).toBe(409);
    expect(
      (await call(ctx, 'DELETE', '/admin/roles/gestor_de_ouvidoria', { cookie: a.cookie })).status,
    ).toBe(409);
    await call(ctx, 'DELETE', `/admin/users/${ana.user.id}/roles/${assigned.body!.roles[0].id}`, {
      cookie: a.cookie,
    });
    expect(
      (await call(ctx, 'DELETE', '/admin/roles/gestor_de_ouvidoria', { cookie: a.cookie })).status,
    ).toBe(204);
  });

  it('papel com acesso ao painel passa a exigir verificação em duas etapas', async () => {
    const a = await admin();
    await call(ctx, 'POST', '/admin/roles', {
      cookie: a.cookie,
      body: { name: 'Consulta', scoped: false, permissions: ['admin.access', 'users.read'] },
    });
    const bia = await signedIn(ctx, { username: 'bia' });
    await call(ctx, 'POST', `/admin/users/${bia.user.id}/roles`, {
      cookie: a.cookie,
      body: { role: 'consulta' },
    });
    const me = await call(ctx, 'GET', '/auth/me', { cookie: bia.cookie });
    expect(me.body!.mfaSetupRequired).toBe(true);
    expect((await call(ctx, 'GET', '/admin/users', { cookie: bia.cookie })).body!.code).toBe(
      'MFA_REQUIRED',
    );
  });

  it('quem não tem uma permissão não a concede a ninguém', async () => {
    const a = await admin();
    await call(ctx, 'POST', '/admin/roles', {
      cookie: a.cookie,
      body: {
        name: 'Gestor de papéis',
        scoped: false,
        permissions: ['admin.access', 'users.read', 'roles.manage', 'roles.assign'],
      },
    });
    const gestor = await signedIn(ctx, { username: 'gestor', mfa: true });
    await call(ctx, 'POST', `/admin/users/${gestor.user.id}/roles`, {
      cookie: a.cookie,
      body: { role: 'gestor_de_papeis' },
    });
    const g = await signedIn(ctx, { username: 'gestor2' }).then(() => gestor);
    const escalate = await call(ctx, 'POST', '/admin/roles', {
      cookie: g.cookie,
      body: { name: 'Tudo', scoped: false, permissions: ['users.delete'] },
    });
    expect(escalate.status).toBe(403);
    const assignSuper = await call(ctx, 'POST', `/admin/users/${gestor.user.id}/roles`, {
      cookie: g.cookie,
      body: { role: 'super_admin' },
    });
    expect(assignSuper.status).toBe(403);
    const ok = await call(ctx, 'POST', '/admin/roles', {
      cookie: g.cookie,
      body: { name: 'Leitor', scoped: false, permissions: ['users.read'] },
    });
    expect(ok.status).toBe(201);
  });
});
