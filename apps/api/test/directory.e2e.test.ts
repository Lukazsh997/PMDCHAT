import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, orgUnits, users } from '../src/database/schema/index.js';
import {
  call,
  createUnit,
  createUser,
  login,
  multipart,
  resetState,
  signedIn,
  startTestApp,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => (ctx = await startTestApp()));
afterAll(async () => ctx.app.close());
beforeEach(async () => resetState(ctx));

let n = 0;
const cid = () => `comunicado-${Date.now()}-${n++}`;

/** Prefeitura > Administração > (CPA, DCA); Saúde à parte. */
async function orgChart() {
  const pref = await createUnit(ctx, 'Prefeitura');
  const adm = await createUnit(ctx, 'Administração', pref);
  const cpa = await createUnit(ctx, 'CPA', adm);
  const dca = await createUnit(ctx, 'DCA', adm);
  const saude = await createUnit(ctx, 'Saúde', pref);
  return { pref, adm, cpa, dca, saude };
}

async function markOnline(userId: string) {
  await ctx.redis.sadd('presence:online', userId);
  await ctx.redis.set(`presence:status:${userId}`, 'online', 'EX', 60);
}

describe('organograma', () => {
  it('lista as unidades ativas com pessoas lotadas e conectadas em cada uma', async () => {
    const u = await orgChart();
    const viewer = await signedIn(ctx, { username: 'viewer', orgUnitId: u.pref.id });
    const elaine = await createUser(ctx, { username: 'elaine', orgUnitId: u.cpa.id });
    await createUser(ctx, { username: 'marcus', orgUnitId: u.cpa.id });
    await createUser(ctx, { username: 'aline', orgUnitId: u.dca.id });
    await markOnline(elaine.user.id);
    await markOnline(viewer.user.id);
    // Registro antigo de uma instância que caiu: não conta.
    await ctx.redis.sadd(
      'presence:online',
      (await createUser(ctx, { username: 'zumbi', orgUnitId: u.dca.id })).user.id,
    );

    const inactive = await createUnit(ctx, 'Extinta', u.pref);
    await createUnit(ctx, 'Filha da extinta', inactive);
    await ctx.db.update(orgUnits).set({ isActive: false }).where(eq(orgUnits.id, inactive.id));

    const res = await call(ctx, 'GET', '/directory/org-tree', { cookie: viewer.cookie });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      (res.body!.units as { name: string }[]).map((x) => [x.name, x]),
    );
    expect(Object.keys(byName).sort()).toEqual([
      'Administração',
      'CPA',
      'DCA',
      'Prefeitura',
      'Saúde',
    ]);
    expect(byName.CPA).toMatchObject({ memberCount: 2, onlineCount: 1, parentId: u.adm.id });
    expect(byName.DCA).toMatchObject({ memberCount: 2, onlineCount: 0 });
    expect(byName.Prefeitura).toMatchObject({ memberCount: 1, onlineCount: 1 });
  });

  it('lista só quem está lotado direto na unidade, com a opção de incluir as subunidades', async () => {
    const u = await orgChart();
    const viewer = await signedIn(ctx, { username: 'viewer' });
    await createUser(ctx, { username: 'chefe', displayName: 'Chefe Adm', orgUnitId: u.adm.id });
    await createUser(ctx, { username: 'elaine', displayName: 'Elaine', orgUnitId: u.cpa.id });
    const direct = await call(
      ctx,
      'GET',
      `/directory/users?orgUnitId=${u.adm.id}&scope=direct&limit=500`,
      {
        cookie: viewer.cookie,
      },
    );
    expect((direct.body as unknown as { username: string }[]).map((x) => x.username)).toEqual([
      'chefe',
    ]);
    const tree = await call(ctx, 'GET', `/directory/users?orgUnitId=${u.adm.id}`, {
      cookie: viewer.cookie,
    });
    expect((tree.body as unknown as unknown[]).length).toBe(2);
  });

  it('convidados não veem o organograma', async () => {
    const guest = await signedIn(ctx, {
      username: 'convidado',
      kind: 'guest',
      accessExpiresAt: new Date(Date.now() + 86_400_000),
    });
    expect((await call(ctx, 'GET', '/directory/org-tree', { cookie: guest.cookie })).status).toBe(
      403,
    );
  });
});

describe('foto de perfil', () => {
  const photo = () =>
    sharp({ create: { width: 900, height: 600, channels: 3, background: '#1c5d99' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'teste' } })
      .toBuffer();

  it('troca, exibe em 256 px sem metadados e remove', async () => {
    const ana = await signedIn(ctx, { username: 'ana' });
    const bia = await signedIn(ctx, { username: 'bia' });
    const up = await call(ctx, 'PUT', '/users/me/avatar', {
      cookie: ana.cookie,
      ...multipart('eu.jpg', await photo(), 'image/jpeg'),
    });
    expect(up.status).toBe(200);
    const url = up.body!.avatarUrl as string;
    expect(url).toMatch(new RegExp(`/api/v1/users/${ana.user.id}/avatar\\?v=`));

    const img = await call(ctx, 'GET', url.replace('/api/v1', ''), { cookie: bia.cookie });
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.raw).metadata();
    expect([meta.width, meta.height, meta.exif]).toEqual([256, 256, undefined]);

    const dir = await call(ctx, 'GET', '/directory/users?q=ana', { cookie: bia.cookie });
    expect((dir.body as unknown as { avatarUrl: string }[])[0]!.avatarUrl).toBe(url);

    const del = await call(ctx, 'DELETE', '/users/me/avatar', { cookie: ana.cookie });
    expect(del.body!.avatarUrl).toBeNull();
    expect(
      (await call(ctx, 'GET', url.replace('/api/v1', ''), { cookie: bia.cookie })).status,
    ).toBe(404);
  });

  it('recusa o que não é foto', async () => {
    const ana = await signedIn(ctx, { username: 'ana' });
    const res = await call(ctx, 'PUT', '/users/me/avatar', {
      cookie: ana.cookie,
      ...multipart('eu.jpg', Buffer.from('<svg onload="alert(1)"></svg>'), 'image/jpeg'),
    });
    expect(res.status).toBe(422);
  });
});

describe('exclusão de usuário', () => {
  it('só o super administrador exclui; a pessoa some, perde o acesso e o login fica livre', async () => {
    const u = await orgChart();
    const admin = await signedIn(ctx, { username: 'admin', role: 'super_admin', mfa: true });
    const unitAdmin = await signedIn(ctx, {
      username: 'chefe',
      role: 'unit_admin',
      roleUnitId: u.adm.id,
      orgUnitId: u.adm.id,
      mfa: true,
    });
    const target = await signedIn(ctx, {
      username: 'elaine',
      displayName: 'Elaine Marques',
      orgUnitId: u.cpa.id,
    });
    const viewer = await signedIn(ctx, { username: 'viewer' });
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: viewer.cookie,
        body: { userId: target.user.id },
      })
    ).body!;
    await call(ctx, 'POST', `/conversations/${conv.id}/messages`, {
      cookie: target.cookie,
      body: { clientId: cid(), body: 'Olá' },
    });

    const denied = await call(ctx, 'DELETE', `/admin/users/${target.user.id}`, {
      cookie: unitAdmin.cookie,
      body: { confirmUsername: 'elaine' },
    });
    expect(denied.status).toBe(403);
    const wrong = await call(ctx, 'DELETE', `/admin/users/${target.user.id}`, {
      cookie: admin.cookie,
      body: { confirmUsername: 'outra' },
    });
    expect(wrong.status).toBe(400);
    const self = await call(ctx, 'DELETE', `/admin/users/${admin.user.id}`, {
      cookie: admin.cookie,
      body: { confirmUsername: 'admin' },
    });
    expect(self.status).toBe(409);

    const ok = await call(ctx, 'DELETE', `/admin/users/${target.user.id}`, {
      cookie: admin.cookie,
      body: { confirmUsername: 'Elaine' },
    });
    expect(ok.status).toBe(204);

    expect((await call(ctx, 'GET', '/auth/me', { cookie: target.cookie })).status).toBe(401);
    await expect(login(ctx, 'elaine', target.password)).rejects.toThrow();
    const dir = await call(ctx, 'GET', '/directory/users?q=elaine', { cookie: viewer.cookie });
    expect(dir.body).toEqual([]);
    const list = await call(ctx, 'GET', '/admin/users?q=elaine', { cookie: admin.cookie });
    expect(list.body!.total).toBe(0);

    // O histórico continua legível para quem conversou com ela.
    const detail = await call(ctx, 'GET', `/conversations/${conv.id}`, { cookie: viewer.cookie });
    expect(detail.body!.peer).toMatchObject({ displayName: 'Elaine Marques', removed: true });
    const msgs = await call(ctx, 'GET', `/conversations/${conv.id}/messages`, {
      cookie: viewer.cookie,
    });
    expect(msgs.body!.items[0].body).toBe('Olá');

    const [row] = await ctx.db.select().from(users).where(eq(users.id, target.user.id));
    expect(row).toMatchObject({ email: null, status: 'disabled' });
    expect(row!.deletedAt).not.toBeNull();
    // Login liberado para outra pessoa.
    await createUser(ctx, { username: 'elaine', displayName: 'Elaine Nova' });

    const audit = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'user.deleted'));
    expect(audit[0]).toMatchObject({ actorId: admin.user.id, entityId: target.user.id });
  });
});

describe('comunicados em massa', () => {
  async function setup() {
    const u = await orgChart();
    const sender = await signedIn(ctx, {
      username: 'comunicacao',
      displayName: 'Comunicação',
      orgUnitId: u.adm.id,
      role: 'broadcaster',
      roleUnitId: u.adm.id,
    });
    const elaine = await signedIn(ctx, { username: 'elaine', orgUnitId: u.cpa.id });
    const marcus = await signedIn(ctx, { username: 'marcus', orgUnitId: u.cpa.id });
    const aline = await signedIn(ctx, { username: 'aline', orgUnitId: u.dca.id });
    const chefe = await signedIn(ctx, { username: 'chefe', orgUnitId: u.adm.id });
    const saude = await signedIn(ctx, { username: 'saude', orgUnitId: u.saude.id });
    await createUser(ctx, { username: 'bloqueado', orgUnitId: u.cpa.id }).then(({ user }) =>
      ctx.db.update(users).set({ status: 'blocked' }).where(eq(users.id, user.id)),
    );
    return { u, sender, elaine, marcus, aline, chefe, saude };
  }
  const post = (cookie: string, body: Record<string, unknown>) =>
    call(ctx, 'POST', '/broadcasts', { cookie, body: { clientId: cid(), ...body } });
  const listOf = async (cookie: string) =>
    (await call(ctx, 'GET', '/conversations', { cookie })).body as unknown as Record<string, any>[];

  it('entrega como mensagem direta a cada pessoa ativa do setor e das subunidades', async () => {
    const { u, sender, elaine, aline, chefe, saude } = await setup();

    const scopes = await call(ctx, 'GET', '/broadcasts/scopes', { cookie: sender.cookie });
    expect(scopes.body).toEqual({ global: false, unitIds: [u.adm.id] });
    const preview = await call(ctx, 'POST', '/broadcasts/preview', {
      cookie: sender.cookie,
      body: { units: [{ orgUnitId: u.adm.id, includeSubunits: true }] },
    });
    expect(preview.body).toEqual({ recipientCount: 4, limit: null });

    // Conversa direta que já existia é reaproveitada.
    const existing = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: elaine.cookie,
        body: { userId: sender.user.id },
      })
    ).body!;

    const clientId = cid();
    const body = {
      units: [{ orgUnitId: u.adm.id, includeSubunits: true }],
      clientId,
      body: 'Ponto facultativo amanhã.',
    };
    const res = await call(ctx, 'POST', '/broadcasts', { cookie: sender.cookie, body });
    expect(res.status).toBe(201);
    expect(res.body!.recipientCount).toBe(4);
    // Reenvio com o mesmo clientId não duplica.
    const again = await call(ctx, 'POST', '/broadcasts', { cookie: sender.cookie, body });
    expect(again.body!.id).toBe(res.body!.id);

    for (const person of [elaine, aline, chefe]) {
      const list = await listOf(person.cookie);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ peer: { id: sender.user.id }, unreadCount: 1 });
      const msgs = await call(ctx, 'GET', `/conversations/${list[0]!.id}/messages`, {
        cookie: person.cookie,
      });
      expect(msgs.body!.items).toEqual([
        expect.objectContaining({
          body: 'Ponto facultativo amanhã.',
          broadcast: { id: res.body!.id, label: 'Administração e subunidades' },
        }),
      ]);
    }
    expect((await listOf(elaine.cookie))[0]!.id).toBe(existing.id);
    expect(await listOf(saude.cookie)).toEqual([]);

    // Quem enviou não ganha uma conversa por destinatário…
    expect(await listOf(sender.cookie)).toEqual([]);
    // …até alguém responder.
    await call(ctx, 'POST', `/conversations/${existing.id}/messages`, {
      cookie: elaine.cookie,
      body: { clientId: cid(), body: 'Obrigada!' },
    });
    const senderList = await listOf(sender.cookie);
    expect(senderList.map((c) => c.id)).toEqual([existing.id]);
    expect(senderList[0]!.unreadCount).toBe(1);

    const audit = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'broadcast.sent'));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ recipients: 4, people: 0 });
  });

  it('junta pessoas e setores sem repetir quem está nos dois', async () => {
    const { u, sender, elaine, marcus, aline, saude } = await setup();
    const res = await post(sender.cookie, {
      units: [{ orgUnitId: u.cpa.id, includeSubunits: false }],
      // Elaine está no setor e também foi escolhida; Aline e a pessoa da Saúde só por nome.
      userIds: [elaine.user.id, aline.user.id, saude.user.id, sender.user.id],
      body: 'Reunião às 15h.',
    });
    expect(res.status).toBe(201);
    expect(res.body!.recipientCount).toBe(4);
    for (const p of [elaine, marcus, aline, saude]) {
      const list = await listOf(p.cookie);
      expect(list).toHaveLength(1);
      const msgs = await call(ctx, 'GET', `/conversations/${list[0]!.id}/messages`, {
        cookie: p.cookie,
      });
      expect(msgs.body!.items).toHaveLength(1);
      expect(msgs.body!.items[0].broadcast.label).toBe('CPA e 3 pessoas');
    }
  });

  it('qualquer pessoa manda para pessoas e setores, até 50 destinatários sem a permissão', async () => {
    const { u, elaine, marcus, aline, saude } = await setup();
    const ok = await post(elaine.cookie, {
      userIds: [marcus.user.id, aline.user.id],
      body: 'Bolo na copa às 16h!',
    });
    expect(ok.status).toBe(201);
    expect(ok.body!.recipientCount).toBe(2);
    const msgs = await call(
      ctx,
      'GET',
      `/conversations/${(await listOf(aline.cookie))[0]!.id}/messages`,
      { cookie: aline.cookie },
    );
    expect(msgs.body!.items[0].broadcast.label).toBe('2 pessoas');

    // Setor fora de qualquer permissão: pode, porque é pequeno.
    const small = await post(elaine.cookie, {
      units: [{ orgUnitId: u.saude.id, includeSubunits: true }],
      body: 'Oi, Saúde',
    });
    expect(small.status).toBe(201);
    expect(small.body!.recipientCount).toBe(1);
    expect(await listOf(saude.cookie)).toHaveLength(1);

    // Setor grande sem a permissão: a prévia avisa o limite e o envio é recusado.
    for (let i = 0; i < 50; i++)
      await createUser(ctx, { username: `cpa${i}`, orgUnitId: u.cpa.id });
    const target = { units: [{ orgUnitId: u.adm.id, includeSubunits: true }] };
    const preview = await call(ctx, 'POST', '/broadcasts/preview', {
      cookie: elaine.cookie,
      body: target,
    });
    expect(preview.body).toEqual({ recipientCount: 54, limit: 50 });
    const big = await post(elaine.cookie, { ...target, body: 'Para todos' });
    expect(big.status).toBe(400);
    expect(big.body!.message).toContain('o limite é 50 pessoas');
  });

  it('pode limitar ao setor e leva anexos que todos os destinatários conseguem abrir', async () => {
    const { u, sender, elaine, chefe } = await setup();
    const file = await call(ctx, 'POST', '/files', {
      cookie: sender.cookie,
      ...multipart('edital.txt', Buffer.from('conteúdo do edital'), 'text/plain'),
    });
    const res = await post(sender.cookie, {
      units: [{ orgUnitId: u.adm.id, includeSubunits: false }],
      attachmentIds: [file.body!.id],
    });
    expect(res.body!.recipientCount).toBe(1);
    expect(await listOf(elaine.cookie)).toEqual([]);
    const got = await call(ctx, 'GET', `/files/${file.body!.id}`, { cookie: chefe.cookie });
    expect(got.status).toBe(200);
    expect(got.raw.toString()).toBe('conteúdo do edital');
  });

  it('com a permissão, o setor no escopo não tem o limite de 50; fora do escopo, tem', async () => {
    const { u, sender, elaine } = await setup();
    for (let i = 0; i < 50; i++)
      await createUser(ctx, { username: `dca${i}`, orgUnitId: u.dca.id });
    const inScope = await call(ctx, 'POST', '/broadcasts/preview', {
      cookie: sender.cookie,
      body: { units: [{ orgUnitId: u.adm.id, includeSubunits: true }] },
    });
    expect(inScope.body).toEqual({ recipientCount: 54, limit: null });
    const mixed = await call(ctx, 'POST', '/broadcasts/preview', {
      cookie: sender.cookie,
      body: {
        units: [
          { orgUnitId: u.adm.id, includeSubunits: true },
          { orgUnitId: u.saude.id, includeSubunits: true },
        ],
      },
    });
    expect(mixed.body).toEqual({ recipientCount: 55, limit: 50 });
    expect((await call(ctx, 'GET', '/broadcasts/scopes', { cookie: elaine.cookie })).body).toEqual({
      global: false,
      unitIds: [],
    });
    expect((await post(sender.cookie, { body: 'sem destino' })).status).toBe(400);
    expect(
      (await post(sender.cookie, { units: [{ orgUnitId: u.cpa.id, includeSubunits: false }] }))
        .status,
    ).toBe(400);
  });
});
