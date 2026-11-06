import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { orgUnits, users } from '../src/database/schema/index.js';
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
import { BASE, FakeAd, SERVICE_DN, SERVICE_PASSWORD } from './support/fake-ad.js';

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

/**
 * Mesmo formato da exportação do sistema antigo (dados fictícios): o código do setor
 * é confiável, mas o nome da secretaria varia ("TI" aparece em PMDC e GOVERNO;
 * "SMF" e "FAZENDA" são a mesma secretaria).
 */
function dump(
  rows: [setor: string, unidade: string | null, id: number | null, nome: string, login: string][],
) {
  const values = rows
    .map(
      ([setor, unidade, id, nome, login]) =>
        `\t ('${setor}',${unidade ? `'${unidade}'` : 'NULL'},${id ?? 'NULL'},'${nome.replace(/'/g, "''")}','','${login}@orgao.local','${login}','user','$2y$12$hash',1)`,
    )
    .join(',\n');
  return `INSERT INTO apping_db.usuarios (setor,unidade,setor_id,nome,cargo,email,username,\`role\`,senha_hash,ativo) VALUES\n${values};`;
}

const FILE = dump([
  ['TI', 'PMDC', 21, 'Ana Lima', '100001'],
  ['TI', 'PMDC', 21, 'Bruno Reis', '100002'],
  ['TI', 'GOVERNO', 21, 'Caio Melo', '100003'],
  ['TESOURARIA', 'SMF', 34, 'Dora Alves', '100004'],
  ['CONTABILIDADE', 'SMF', 40, 'Edu Rocha', '100005'],
  ['GABINETE', 'FAZENDA', 42, 'Fábio Dias', '100006'],
  ['GABINETE', 'GOVERNO', 44, 'Gil Souza', '100007'],
  ['TI', null, null, "Hugo D'Ávila", '100008'],
]);

async function admin() {
  return signedIn(ctx, { username: 'chefe', displayName: 'Chefe', role: 'super_admin', mfa: true });
}

const preview = (cookie: string, body: Record<string, unknown> = {}) =>
  call(ctx, 'POST', '/admin/roster/preview', {
    cookie,
    body: { fileName: 'usuarios.sql', content: FILE, ...body },
  });
const apply = (cookie: string, body: Record<string, unknown> = {}) =>
  call(ctx, 'POST', '/admin/roster/apply', {
    cookie,
    body: { fileName: 'usuarios.sql', content: FILE, ...body },
  });

async function adUser(username: string, displayName: string) {
  const { user } = await createUser(ctx, { username, displayName });
  await ctx.db.update(users).set({ authSource: 'ldap' }).where(eq(users.id, user.id));
  return user;
}

const byName = async (username: string) =>
  (await ctx.db.select().from(users).where(eq(users.username, username)))[0];

describe('Lista de lotação', () => {
  it('só o super administrador importa', async () => {
    const comum = await signedIn(ctx, { username: 'comum' });
    expect((await preview(comum.cookie)).status).toBe(403);
  });

  it('prévia: setores pelo código, secretaria mais frequente, sugestões e nada gravado', async () => {
    const { cookie } = await admin();
    const pmd = await createUnit(ctx, 'Prefeitura');
    await ctx.db.update(orgUnits).set({ kind: 'orgao' }).where(eq(orgUnits.id, pmd.id));
    const smf = await createUnit(ctx, 'Secretaria de Fazenda', pmd);
    await ctx.db.update(orgUnits).set({ acronym: 'SMF' }).where(eq(orgUnits.id, smf.id));
    const gov = await createUnit(ctx, 'Secretaria Municipal de Governo', pmd);
    await ctx.db.update(orgUnits).set({ kind: 'secretaria' }).where(eq(orgUnits.id, gov.id));

    const r = await preview(cookie);
    expect(r.status).toBe(200);
    const plan = r.body!;
    expect(plan).toMatchObject({ format: 'sql', rows: 8, parentId: pmd.id });
    expect(plan.secretarias).toEqual([
      expect.objectContaining({ raw: 'FAZENDA', decision: 'create' }),
      // "GOVERNO" no arquivo = "Secretaria Municipal de Governo" no organograma.
      expect.objectContaining({ raw: 'GOVERNO', people: 2, decision: `existing:${gov.id}` }),
      expect.objectContaining({ raw: 'PMDC', people: 2 }),
      expect.objectContaining({ raw: 'SMF', decision: `existing:${smf.id}` }),
    ]);
    // TI (código 21): 2× PMDC, 1× GOVERNO; o Hugo sem código entra no mesmo setor pelo nome.
    const ti = plan.setores.find((s: any) => s.name === 'TI');
    expect(ti).toMatchObject({
      secretaria: 'PMDC',
      people: 4,
      alternatives: [{ secretaria: 'GOVERNO', people: 1 }],
    });
    expect(plan.people).toMatchObject({ total: 8, withoutAccount: 8 });
    // Nada foi gravado.
    expect((await ctx.db.select().from(orgUnits)).length).toBe(3);
  });

  it('aplica: cria secretarias e setores, lota quem já tem conta e remove quem é do AD e não está na lista', async () => {
    const { cookie, user: chefe } = await admin();
    const pmd = await createUnit(ctx, 'Prefeitura');
    const ana = await adUser('100001', 'Ana Lima');
    const fora = await adUser('200001', 'Pessoa Fora');
    const local = await createUser(ctx, { username: 'local.user' });

    // FAZENDA é a mesma secretaria que SMF; o setor TI fica no GOVERNO.
    const decisions = {
      secretarias: { FAZENDA: 'alias:SMF' },
      setores: { 'id:21': 'GOVERNO' },
    };
    const p = (await preview(cookie, decisions)).body!;
    expect(p.removal).toMatchObject({ mode: 'delete', count: 1, people: [{ username: '200001' }] });
    expect(p.secretarias.find((s: any) => s.raw === 'FAZENDA').target).toContain('mesma que SMF');

    const r = await apply(cookie, decisions);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ removed: 1, moved: 1, entries: 8 });

    const all = await ctx.db.select().from(orgUnits);
    const unit = (name: string, parentId?: string) =>
      all.find((u) => u.name === name && (parentId === undefined || u.parentId === parentId));
    // Secretarias novas ficam abaixo da única raiz (Prefeitura).
    const governo = unit('GOVERNO', pmd.id)!;
    const smf = unit('SMF', pmd.id)!;
    expect(governo.kind).toBe('secretaria');
    expect(unit('FAZENDA')).toBeUndefined();
    expect(unit('PMDC')).toBeDefined();
    const ti = unit('TI', governo.id)!;
    expect(ti.kind).toBe('setor');
    expect(unit('GABINETE', smf.id)).toBeDefined();
    expect(unit('GABINETE', governo.id)).toBeDefined();

    expect((await byName('100001'))!.orgUnitId).toBe(ti.id);
    expect((await ctx.db.select().from(users).where(eq(users.id, ana.id)))[0]!.orgUnitId).toBe(
      ti.id,
    );
    // Do AD e fora da lista: excluída. Conta local e o super administrador ficam.
    const [gone] = await ctx.db.select().from(users).where(eq(users.id, fora.id));
    expect(gone!.deletedAt).not.toBeNull();
    expect((await byName('local.user'))!.deletedAt).toBeNull();
    expect(
      (await ctx.db.select().from(users).where(eq(users.id, chefe.id)))[0]!.deletedAt,
    ).toBeNull();
    await login(ctx, 'local.user', local.password);

    const status = await call(ctx, 'GET', '/admin/roster', { cookie });
    expect(status.body).toMatchObject({
      active: true,
      entries: 8,
      lastImport: { fileName: 'usuarios.sql', actorName: 'Chefe' },
    });

    // Importar o mesmo arquivo de novo não duplica nada.
    await apply(cookie, decisions);
    expect((await ctx.db.select().from(orgUnits)).length).toBe(all.length);
  });

  it('desativar em vez de excluir; remoção grande pede confirmação', async () => {
    const { cookie } = await admin();
    for (let i = 0; i < 8; i++) await adUser(`30000${i}`, `Fora ${i}`);
    await adUser('100001', 'Ana Lima');

    const blocked = await apply(cookie, { removal: 'disable' });
    expect(blocked.status).toBe(409);
    expect((await byName('300000'))!.status).toBe('active');

    const ok = await apply(cookie, { removal: 'disable', confirmLargeRemoval: true });
    expect(ok.body).toMatchObject({ removed: 8 });
    const u = (await byName('300000'))!;
    expect(u).toMatchObject({ status: 'disabled', deletedAt: null });
    expect(u.ldapDisabledAt).not.toBeNull();
  });

  it('com o AD: quem está na lista ganha conta no setor da lista; quem não está, não entra', async () => {
    const { cookie } = await admin();
    await call(ctx, 'PUT', '/admin/ldap/settings', {
      cookie,
      body: {
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
      },
    });
    await apply(cookie);
    const settings = await call(ctx, 'GET', '/admin/ldap/settings', { cookie });
    expect(settings.body!.orgUnitSource).toBe('roster');

    ad.add(
      { username: '100004', displayName: 'Dora Alves', ou: 'OU=USUARIOS,OU=SMF' },
      { username: '999999', displayName: 'Não Está', ou: 'OU=USUARIOS,OU=SMF' },
    );
    const run = await call(ctx, 'POST', '/admin/ldap/sync', {
      cookie,
      body: { confirmLargeChanges: false },
    });
    expect(run.body!.summary).toMatchObject({ created: 1, outsideRoster: 1 });
    const tesouraria = (await ctx.db.select().from(orgUnits)).find((u) => u.name === 'TESOURARIA')!;
    expect((await byName('100004'))!.orgUnitId).toBe(tesouraria.id);
    expect(await byName('999999')).toBeUndefined();

    const denied = await call(ctx, 'POST', '/auth/login', {
      body: { username: '999999', password: 'senhaDoAd2026' },
    });
    expect(denied.status).toBe(403);
    expect(denied.body!.message).toContain('ainda não foi liberada');

    // Voltar a usar as OUs: a lista deixa de valer.
    await call(ctx, 'POST', '/admin/roster/deactivate', { cookie });
    expect((await login(ctx, '999999', 'senhaDoAd2026')).length).toBeGreaterThan(0);
  });

  it('arquivo que não dá para ler: mensagem clara', async () => {
    const { cookie } = await admin();
    const r = await call(ctx, 'POST', '/admin/roster/preview', {
      cookie,
      body: { fileName: 'x.csv', content: 'nome;cargo\nAna;Analista\n' },
    });
    expect(r.status).toBe(400);
    expect(r.body!.message).toContain('login e setor');
  });
});
