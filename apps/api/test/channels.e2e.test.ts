import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createUnit,
  createUser,
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
const cid = () => `ch-${Date.now()}-${n++}`;
const list = async (cookie: string) =>
  (await call(ctx, 'GET', '/conversations', { cookie })).body as unknown as Record<string, any>[];

/** A sincronização roda logo depois da resposta: espera ela terminar. */
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condição não foi atingida');
}

async function setup() {
  const pref = await createUnit(ctx, 'Prefeitura');
  const sead = await createUnit(ctx, 'SEAD', pref);
  const rh = await createUnit(ctx, 'RH', sead);
  const saude = await createUnit(ctx, 'Saúde', pref);
  const gestor = await signedIn(ctx, {
    username: 'gestor',
    displayName: 'Gestora Comunicação',
    orgUnitId: sead.id,
    role: 'broadcaster',
    roleUnitId: sead.id,
  });
  const ana = await signedIn(ctx, { username: 'ana', displayName: 'Ana Lima', orgUnitId: rh.id });
  const bia = await signedIn(ctx, {
    username: 'bia',
    displayName: 'Bia Souza',
    orgUnitId: saude.id,
  });
  return { pref, sead, rh, saude, gestor, ana, bia };
}

describe('canais de aviso', () => {
  it('canal de unidade traz as pessoas lotadas e só administradores publicam', async () => {
    const { sead, gestor, ana, bia } = await setup();
    const scopes = await call(ctx, 'GET', '/permissions/conversations.create_channel/scopes', {
      cookie: gestor.cookie,
    });
    expect(scopes.body).toEqual({ global: false, unitIds: [sead.id] });

    const res = await call(ctx, 'POST', '/conversations/channel', {
      cookie: gestor.cookie,
      body: { name: 'Avisos da SEAD', orgUnitId: sead.id, includeSubunits: true },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'group',
      title: 'Avisos da SEAD',
      myRole: 'owner',
      channel: { orgUnit: { id: sead.id, name: 'SEAD' }, includeSubunits: true },
      memberCount: 2,
    });
    const channelId = res.body!.id as string;

    const post = await call(ctx, 'POST', `/conversations/${channelId}/messages`, {
      cookie: gestor.cookie,
      body: { clientId: cid(), body: 'Expediente até 14h na sexta.' },
    });
    expect(post.status).toBe(201);
    const denied = await call(ctx, 'POST', `/conversations/${channelId}/messages`, {
      cookie: ana.cookie,
      body: { clientId: cid(), body: 'Posso falar?' },
    });
    expect(denied.status).toBe(403);
    // Pode reagir.
    expect(
      (
        await call(ctx, 'PUT', `/messages/${post.body!.id}/reactions`, {
          cookie: ana.cookie,
          body: { emoji: '👍' },
        })
      ).status,
    ).toBe(200);
    // Membro automático não sai do canal (silencia, se quiser).
    expect(
      (
        await call(ctx, 'DELETE', `/conversations/${channelId}/members/${ana.user.id}`, {
          cookie: ana.cookie,
        })
      ).status,
    ).toBe(409);
    expect((await list(bia.cookie)).some((c) => c.id === channelId)).toBe(false);
  });

  it('quem entra na unidade passa a ver os avisos anteriores; quem sai, deixa o canal', async () => {
    const { sead, rh, saude, gestor, bia } = await setup();
    const admin = await signedIn(ctx, { username: 'admin', role: 'super_admin', mfa: true });
    const channelId = (
      await call(ctx, 'POST', '/conversations/channel', {
        cookie: gestor.cookie,
        body: { name: 'Avisos da SEAD', orgUnitId: sead.id },
      })
    ).body!.id as string;
    await call(ctx, 'POST', `/conversations/${channelId}/messages`, {
      cookie: gestor.cookie,
      body: { clientId: cid(), body: 'Aviso antigo' },
    });

    // Bia muda da Saúde para o RH (abaixo da SEAD).
    await call(ctx, 'PATCH', `/admin/users/${bia.user.id}`, {
      cookie: admin.cookie,
      body: { orgUnitId: rh.id },
    });
    await eventually(async () => (await list(bia.cookie)).some((c) => c.id === channelId));
    const msgs = await call(ctx, 'GET', `/conversations/${channelId}/messages`, {
      cookie: bia.cookie,
    });
    expect(msgs.body!.items.map((m: { body: string }) => m.body)).toContain('Aviso antigo');

    // Volta para a Saúde: sai do canal.
    await call(ctx, 'PATCH', `/admin/users/${bia.user.id}`, {
      cookie: admin.cookie,
      body: { orgUnitId: saude.id },
    });
    await eventually(async () => !(await list(bia.cookie)).some((c) => c.id === channelId));

    // Pessoa nova criada já lotada no RH entra sozinha.
    const created = await call(ctx, 'POST', '/admin/users', {
      cookie: admin.cookie,
      body: { username: 'novato', displayName: 'Novato Silva', orgUnitId: rh.id },
    });
    await eventually(async () => {
      const d = await call(ctx, 'GET', `/conversations/${channelId}`, { cookie: gestor.cookie });
      return d.body!.members.some(
        (m: { id: string; autoJoined: boolean }) => m.id === created.body!.user.id && m.autoJoined,
      );
    });
  });

  it('exige permissão e respeita o escopo da unidade', async () => {
    const { saude, gestor, ana } = await setup();
    const outside = await call(ctx, 'POST', '/conversations/channel', {
      cookie: gestor.cookie,
      body: { name: 'Canal da Saúde', orgUnitId: saude.id },
    });
    expect(outside.status).toBe(403);
    const common = await call(ctx, 'POST', '/conversations/channel', {
      cookie: ana.cookie,
      body: { name: 'Meu canal', memberIds: [gestor.user.id] },
    });
    expect(common.status).toBe(403);
    // Canal sem unidade, com pessoas escolhidas: vale para quem tem a permissão.
    const extra = await createUser(ctx, { username: 'extra', displayName: 'Extra' });
    const manual = await call(ctx, 'POST', '/conversations/channel', {
      cookie: gestor.cookie,
      body: { name: 'Plantão', memberIds: [ana.user.id, extra.user.id] },
    });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({ memberCount: 3, channel: { orgUnit: null } });
  });
});
