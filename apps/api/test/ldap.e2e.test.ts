import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ldapSettings, roleAssignments, users } from '../src/database/schema/index.js';
import { LdapScheduler } from '../src/modules/ldap/index.js';
import {
  call,
  createUnit,
  createUser,
  login,
  resetState,
  signedIn,
  startTestApp,
  type TestContext,
} from './helpers.js';
import { BASE, FakeAd, guidFor, SERVICE_DN, SERVICE_PASSWORD } from './support/fake-ad.js';

let ctx: TestContext;
const ad = new FakeAd();
beforeAll(async () => {
  ctx = await startTestApp();
  await ad.start();
});
afterAll(async () => {
  await ad.stop();
  await ctx.app.close();
});
beforeEach(async () => {
  await resetState(ctx);
  ad.reset();
});

const AD_PASSWORD = 'senhaDoAd2026';

async function admin() {
  return signedIn(ctx, { username: 'chefe', displayName: 'Chefe', role: 'super_admin', mfa: true });
}

function settingsBody(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    url: ad.url,
    startTls: false,
    tlsVerify: true,
    caCert: '',
    bindDn: SERVICE_DN,
    bindPassword: SERVICE_PASSWORD,
    baseDn: BASE,
    userFilter: '(&(objectCategory=person)(objectClass=user))',
    usernameAttribute: 'sAMAccountName',
    displayNameAttribute: 'displayName',
    emailAttribute: 'mail',
    jobTitleAttribute: 'title',
    defaultOrgUnitId: null,
    autoProvision: true,
    syncIntervalMinutes: 60,
    ...over,
  };
}

async function configure(cookie: string, over: Record<string, unknown> = {}) {
  const r = await call(ctx, 'PUT', '/admin/ldap/settings', { cookie, body: settingsBody(over) });
  expect(r.status).toBe(200);
  return r.body!;
}

const userByName = async (username: string) =>
  (await ctx.db.select().from(users).where(eq(users.username, username)))[0];

describe('Active Directory: configuração', () => {
  it('só quem configura integrações acessa; a senha da conta de serviço fica cifrada e não volta', async () => {
    const common = await signedIn(ctx, { username: 'comum' });
    expect((await call(ctx, 'GET', '/admin/ldap/settings', { cookie: common.cookie })).status).toBe(
      403,
    );

    const { cookie } = await admin();
    const saved = await configure(cookie);
    expect(saved.hasBindPassword).toBe(true);
    expect(saved).not.toHaveProperty('bindPassword');
    expect(JSON.stringify(saved)).not.toContain(SERVICE_PASSWORD);
    const [row] = await ctx.db.select().from(ldapSettings);
    expect(row!.bindPasswordEnc).toBeTruthy();
    expect(row!.bindPasswordEnc).not.toContain(SERVICE_PASSWORD);

    // Salvar de novo sem senha mantém a guardada.
    await configure(cookie, { bindPassword: '' });
    ad.add({ username: 'joao', displayName: 'João Silva', ou: 'OU=SEAD' });
    const test = await call(ctx, 'POST', '/admin/ldap/test', {
      cookie,
      body: settingsBody({ bindPassword: '' }),
    });
    expect(test.body).toMatchObject({ ok: true, userCount: 1 });

    // Senha errada no teste: mensagem clara, sem salvar nada.
    const wrong = await call(ctx, 'POST', '/admin/ldap/test', {
      cookie,
      body: settingsBody({ bindPassword: 'errada' }),
    });
    expect(wrong.body).toMatchObject({ ok: false });
    expect(wrong.body!.message).toContain('conta de serviço');

    // A auditoria registra a mudança sem a senha.
    const audit = await call(ctx, 'GET', '/admin/audit?action=ldap.settings_changed', { cookie });
    expect(JSON.stringify(audit.body)).not.toContain(SERVICE_PASSWORD);
  });

  it('lista OUs com sugestão pelo nome e guarda o mapeamento; grupo não pode dar super administrador', async () => {
    const { cookie } = await admin();
    await configure(cookie);
    const sead = await createUnit(ctx, 'SEAD');
    ad.ous = ['OU=SEAD', 'OU=DCA,OU=SEAD'];
    ad.groups = [{ cn: 'Chat-Admins', description: 'Administradores do chat' }];

    const ous = await call(ctx, 'GET', '/admin/ldap/ous', { cookie });
    expect(ous.body).toEqual([
      expect.objectContaining({ name: 'SEAD', depth: 0, suggestedOrgUnitId: sead.id }),
      expect.objectContaining({ name: 'DCA', depth: 1, suggestedOrgUnitId: null }),
    ]);
    const put = await call(ctx, 'PUT', '/admin/ldap/ous', {
      cookie,
      body: { mappings: [{ dn: ous.body![0].dn, orgUnitId: sead.id }] },
    });
    expect(put.status).toBe(200);
    const again = await call(ctx, 'GET', '/admin/ldap/ous', { cookie });
    expect(again.body![0].orgUnitId).toBe(sead.id);

    const groups = await call(ctx, 'GET', '/admin/ldap/groups', { cookie });
    const dn = groups.body![0].dn as string;
    const bad = await call(ctx, 'PUT', '/admin/ldap/groups', {
      cookie,
      body: { mappings: [{ dn, role: 'super_admin', orgUnitId: null }] },
    });
    expect(bad.status).toBe(400);
    const noUnit = await call(ctx, 'PUT', '/admin/ldap/groups', {
      cookie,
      body: { mappings: [{ dn, role: 'unit_admin', orgUnitId: null }] },
    });
    expect(noUnit.status).toBe(400);
    const ok = await call(ctx, 'PUT', '/admin/ldap/groups', {
      cookie,
      body: { mappings: [{ dn, role: 'unit_admin', orgUnitId: sead.id }] },
    });
    expect(ok.status).toBe(200);
  });
});

describe('Active Directory: login', () => {
  it('entra com a senha do AD (cria a conta no 1º login) e aceita DOMINIO\\login', async () => {
    const { cookie } = await admin();
    await configure(cookie);
    const sead = await createUnit(ctx, 'SEAD');
    await call(ctx, 'PUT', '/admin/ldap/ous', {
      cookie,
      body: { mappings: [{ dn: `OU=SEAD,${BASE}`, orgUnitId: sead.id }] },
    });
    ad.add({
      username: 'joao',
      displayName: 'João Silva',
      ou: 'OU=DCA,OU=SEAD',
      email: 'joao@orgao.gov.br',
      title: 'Analista',
    });

    const ok = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'ORGAO\\joao', password: AD_PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect(ok.body!.user).toMatchObject({ username: 'joao', displayName: 'João Silva' });
    const u = await userByName('joao');
    expect(u).toMatchObject({
      authSource: 'ldap',
      externalId: '6f616f6a-0000-0000-0000-000000000000',
      orgUnitId: sead.id,
      email: 'joao@orgao.gov.br',
      jobTitle: 'Analista',
    });

    // UPN também serve.
    expect(
      (
        await call(ctx, 'POST', '/auth/login', {
          body: { username: 'joao@orgao.local', password: AD_PASSWORD },
        })
      ).status,
    ).toBe(200);

    // Senha errada ou vazia: recusado (vazia seria um bind anônimo no LDAP).
    for (const password of ['errada', '']) {
      const r = await call(ctx, 'POST', '/auth/login', { body: { username: 'joao', password } });
      expect([400, 401]).toContain(r.status);
    }
    // Filtro com caracteres especiais não vira curinga.
    const star = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'jo*', password: AD_PASSWORD },
    });
    expect([400, 401]).toContain(star.status);

    // A senha local não existe para contas do AD: trocar senha pelo sistema é recusado.
    const session = await login(ctx, 'joao', AD_PASSWORD);
    const change = await call(ctx, 'POST', '/auth/password', {
      cookie: session,
      body: { currentPassword: AD_PASSWORD, newPassword: 'outraSenha2026!' },
    });
    expect(change.status).toBeGreaterThanOrEqual(400);
  });

  it('sem criação automática, quem não tem conta não entra; conta desativada no AD não entra', async () => {
    const { cookie } = await admin();
    await configure(cookie, { autoProvision: false });
    ad.add({ username: 'novo', displayName: 'Novo', ou: 'OU=SEAD' });
    ad.add({ username: 'saiu', displayName: 'Saiu', ou: 'OU=SEAD', disabled: true });
    const novo = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'novo', password: AD_PASSWORD },
    });
    expect(novo.status).toBe(403);
    expect(await userByName('novo')).toBeUndefined();
    const saiu = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'saiu', password: AD_PASSWORD },
    });
    expect([401, 403]).toContain(saiu.status);
  });

  it('AD fora do ar: contas do AD recebem 503; contas locais continuam entrando', async () => {
    const { cookie } = await admin();
    await configure(cookie);
    ad.add({ username: 'joao', displayName: 'João Silva', ou: 'OU=SEAD' });
    await login(ctx, 'joao', AD_PASSWORD);
    const local = await createUser(ctx, { username: 'local.user' });

    ad.down = true;
    const r = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'joao', password: AD_PASSWORD },
    });
    expect(r.status).toBe(503);
    expect(r.body!.code).toBe('DIRECTORY_UNAVAILABLE');
    await login(ctx, 'local.user', local.password);
  });

  it('com a integração desligada, contas do AD não entram (nem com a senha local antiga)', async () => {
    const { cookie } = await admin();
    await configure(cookie);
    ad.add({ username: 'joao', displayName: 'João Silva', ou: 'OU=SEAD' });
    await login(ctx, 'joao', AD_PASSWORD);
    await configure(cookie, { enabled: false });
    const r = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'joao', password: AD_PASSWORD },
    });
    expect(r.status).toBe(403);
  });
});

describe('Active Directory: sincronização', () => {
  async function setup() {
    const a = await admin();
    await configure(a.cookie);
    const sead = await createUnit(ctx, 'SEAD');
    const dca = await createUnit(ctx, 'DCA', sead);
    ad.ous = ['OU=SEAD', 'OU=DCA,OU=SEAD'];
    ad.groups = [{ cn: 'Chat-Gestores' }];
    await call(ctx, 'PUT', '/admin/ldap/ous', {
      cookie: a.cookie,
      body: {
        mappings: [
          { dn: `OU=SEAD,${BASE}`, orgUnitId: sead.id },
          { dn: `OU=DCA,OU=SEAD,${BASE}`, orgUnitId: dca.id },
        ],
      },
    });
    await call(ctx, 'PUT', '/admin/ldap/groups', {
      cookie: a.cookie,
      body: {
        mappings: [{ dn: ad.groupDn('Chat-Gestores'), role: 'unit_admin', orgUnitId: sead.id }],
      },
    });
    return { ...a, sead, dca };
  }
  const sync = (cookie: string, confirmLargeChanges = false) =>
    call(ctx, 'POST', '/admin/ldap/sync', { cookie, body: { confirmLargeChanges } });

  it('cria, lota pela OU mais específica, dá papel pelo grupo e liga a conta local de mesmo login', async () => {
    const { cookie, sead, dca } = await setup();
    const local = await createUser(ctx, { username: 'maria', displayName: 'Maria (local)' });
    ad.add(
      {
        username: 'joao',
        displayName: 'João Silva',
        ou: 'OU=DCA,OU=SEAD',
        groups: ['Chat-Gestores'],
      },
      { username: 'maria', displayName: 'Maria Souza', ou: 'OU=SEAD' },
    );

    const preview = await call(ctx, 'POST', '/admin/ldap/preview', { cookie });
    expect(preview.body).toMatchObject({ created: 1, updated: 1, needsConfirmation: false });
    expect(preview.body!.changes.map((c: any) => c.kind).sort()).toEqual(['create', 'update']);
    // A prévia não grava nada.
    expect(await userByName('joao')).toBeUndefined();

    const run = await sync(cookie);
    expect(run.body).toMatchObject({ status: 'success', trigger: 'manual', actorName: 'Chefe' });
    const joao = (await userByName('joao'))!;
    expect(joao.orgUnitId).toBe(dca.id);
    const roles = await ctx.db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, joao.id));
    expect(roles).toEqual([
      expect.objectContaining({ role: 'unit_admin', orgUnitId: sead.id, source: 'ldap' }),
    ]);

    const maria = (await userByName('maria'))!;
    expect(maria.id).toBe(local.user.id);
    expect(maria).toMatchObject({
      authSource: 'ldap',
      displayName: 'Maria Souza',
      orgUnitId: sead.id,
    });
    // A senha local antiga deixou de valer; a do AD vale.
    const old = await call(ctx, 'POST', '/auth/login', {
      body: { username: 'maria', password: local.password },
    });
    expect(old.status).toBe(401);
    await login(ctx, 'maria', AD_PASSWORD);

    // Rodar de novo sem mudanças no AD: nada muda.
    const again = await sync(cookie);
    expect(again.body!.summary).toMatchObject({
      created: 0,
      updated: 0,
      disabled: 0,
      roleChanges: 0,
    });
  });

  it('mudança no AD: lotação, nome, saída do grupo; desativa e reativa', async () => {
    const { cookie, sead } = await setup();
    ad.add({
      username: 'joao',
      displayName: 'João Silva',
      ou: 'OU=DCA,OU=SEAD',
      groups: ['Chat-Gestores'],
    });
    await sync(cookie);
    const session = await login(ctx, 'joao', AD_PASSWORD);

    ad.add({ username: 'joao', displayName: 'João S. Lima', ou: 'OU=SEAD', groups: [] });
    let r = await sync(cookie);
    expect(r.body!.summary).toMatchObject({ updated: 1, roleChanges: 1 });
    let joao = (await userByName('joao'))!;
    expect(joao).toMatchObject({ displayName: 'João S. Lima', orgUnitId: sead.id });
    expect(
      await ctx.db.select().from(roleAssignments).where(eq(roleAssignments.userId, joao.id)),
    ).toEqual([]);

    ad.add({ username: 'joao', displayName: 'João S. Lima', ou: 'OU=SEAD', disabled: true });
    r = await sync(cookie);
    expect(r.body!.summary).toMatchObject({ disabled: 1 });
    joao = (await userByName('joao'))!;
    expect(joao.status).toBe('disabled');
    // Sessões abertas caem na hora.
    expect((await call(ctx, 'GET', '/auth/me', { cookie: session })).status).toBe(401);

    ad.add({ username: 'joao', displayName: 'João S. Lima', ou: 'OU=SEAD', disabled: false });
    r = await sync(cookie);
    expect(r.body!.summary).toMatchObject({ reenabled: 1 });
    expect((await userByName('joao'))!.status).toBe('active');
    await login(ctx, 'joao', AD_PASSWORD);
  });

  it('quem sumiu do AD é desativado, mas conta desativada à mão no painel não é reativada', async () => {
    const { cookie } = await setup();
    ad.add(
      { username: 'joao', displayName: 'João', ou: 'OU=SEAD' },
      { username: 'ana', displayName: 'Ana', ou: 'OU=SEAD' },
      { username: 'bia', displayName: 'Bia', ou: 'OU=SEAD' },
    );
    await sync(cookie);
    ad.people.delete('ana');
    const r = await sync(cookie);
    expect(r.body!.summary).toMatchObject({ disabled: 1 });
    expect((await userByName('ana'))!.status).toBe('disabled');

    // Desativada à mão (não pelo AD): a sincronização não desfaz.
    const bia = (await userByName('bia'))!;
    await ctx.db.update(users).set({ status: 'disabled' }).where(eq(users.id, bia.id));
    await sync(cookie);
    expect((await userByName('bia'))!.status).toBe('disabled');
  });

  it('para e pede confirmação se fosse desativar gente demais (ou se o AD vier vazio)', async () => {
    const { cookie } = await setup();
    for (let i = 0; i < 10; i++) {
      ad.add({ username: `pessoa${i}`, displayName: `Pessoa ${i}`, ou: 'OU=SEAD' });
    }
    await sync(cookie);
    for (let i = 0; i < 7; i++) ad.people.delete(`pessoa${i}`);

    const blocked = await sync(cookie);
    expect(blocked.body).toMatchObject({ status: 'blocked' });
    expect(blocked.body!.summary).toMatchObject({ disabled: 7, needsConfirmation: true });
    expect((await userByName('pessoa0'))!.status).toBe('active');

    const confirmed = await sync(cookie, true);
    expect(confirmed.body).toMatchObject({ status: 'success' });
    expect((await userByName('pessoa0'))!.status).toBe('disabled');

    // AD vazio (ex.: base de busca errada): nunca desativa todo mundo sem confirmação.
    ad.people.clear();
    expect((await sync(cookie)).body).toMatchObject({ status: 'blocked' });
    expect((await userByName('pessoa9'))!.status).toBe('active');

    const runs = await call(ctx, 'GET', '/admin/ldap/runs', { cookie });
    expect(runs.body!.map((r: any) => r.status)).toEqual([
      'blocked',
      'success',
      'blocked',
      'success',
    ]);
  });

  it('o super administrador local nunca é ligado ao AD, mesmo com o mesmo login', async () => {
    const { cookie } = await setup();
    const chefe = (await userByName('chefe'))!;
    ad.add({
      username: 'chefe',
      displayName: 'Chefe no AD',
      ou: 'OU=SEAD',
      guid: guidFor('chefe'),
    });
    const r = await sync(cookie);
    expect(r.body!.summary.problems.join(' ')).toContain('chefe');
    const after = (await userByName('chefe'))!;
    expect(after).toMatchObject({ id: chefe.id, authSource: 'local', displayName: 'Chefe' });
    expect(
      await ctx.db
        .select()
        .from(roleAssignments)
        .where(and(eq(roleAssignments.userId, chefe.id), eq(roleAssignments.role, 'super_admin'))),
    ).toHaveLength(1);
  });

  it('a agenda roda quando o intervalo passou e não roda com a integração desligada', async () => {
    const { cookie } = await setup();
    ad.add({ username: 'joao', displayName: 'João', ou: 'OU=SEAD' });
    const scheduler = ctx.app.get(LdapScheduler);
    expect(await scheduler.tick()).toBe(true);
    expect(await userByName('joao')).toBeDefined();
    // Acabou de rodar: só depois do intervalo.
    expect(await scheduler.tick()).toBe(false);
    expect(await scheduler.tick(new Date(Date.now() + 61 * 60_000))).toBe(true);
    await configure(cookie, { enabled: false });
    expect(await scheduler.tick(new Date(Date.now() + 200 * 60_000))).toBe(false);
    const runs = await call(ctx, 'GET', '/admin/ldap/runs', { cookie });
    expect(runs.body!.every((r: any) => r.trigger === 'schedule')).toBe(true);
  });
});
