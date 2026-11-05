import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
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
const cid = () => `c-${Date.now()}-${n++}`;

async function group(memberCount = 0) {
  const ana = await signedIn(ctx, { username: 'ana', displayName: 'Ana Lima' });
  const bia = await signedIn(ctx, { username: 'bia', displayName: 'Bia Souza' });
  const caio = await signedIn(ctx, { username: 'caio', displayName: 'Caio Melo' });
  const extra: string[] = [];
  for (let i = 0; i < memberCount; i++) {
    extra.push(
      (await createUser(ctx, { username: `extra${i}`, displayName: `Extra ${i}` })).user.id,
    );
  }
  const g = (
    await call(ctx, 'POST', '/conversations/group', {
      cookie: ana.cookie,
      body: { name: 'Projeto', memberIds: [bia.user.id, caio.user.id, ...extra] },
    })
  ).body!;
  return { ana, bia, caio, g };
}
const send = (cookie: string, conversationId: string, body: Record<string, unknown>) =>
  call(ctx, 'POST', `/conversations/${conversationId}/messages`, {
    cookie,
    body: { clientId: cid(), ...body },
  });
const list = async (cookie: string) =>
  (await call(ctx, 'GET', '/conversations', { cookie })).body as unknown as Record<string, any>[];

describe('reações', () => {
  it('liga e desliga a reação de cada pessoa', async () => {
    const { ana, bia, caio, g } = await group();
    const m = (await send(ana.cookie, g.id, { body: 'Aprovado!' })).body!;
    await call(ctx, 'PUT', `/messages/${m.id}/reactions`, {
      cookie: bia.cookie,
      body: { emoji: '👍' },
    });
    await call(ctx, 'PUT', `/messages/${m.id}/reactions`, {
      cookie: caio.cookie,
      body: { emoji: '👍' },
    });
    // Repetir não duplica.
    const r = await call(ctx, 'PUT', `/messages/${m.id}/reactions`, {
      cookie: caio.cookie,
      body: { emoji: '👍' },
    });
    await call(ctx, 'PUT', `/messages/${m.id}/reactions`, {
      cookie: caio.cookie,
      body: { emoji: '❤️' },
    });
    expect(r.body!.reactions).toEqual([{ emoji: '👍', userIds: [bia.user.id, caio.user.id] }]);
    const off = await call(ctx, 'DELETE', `/messages/${m.id}/reactions`, {
      cookie: bia.cookie,
      body: { emoji: '👍' },
    });
    expect(off.body!.reactions).toEqual([
      { emoji: '👍', userIds: [caio.user.id] },
      { emoji: '❤️', userIds: [caio.user.id] },
    ]);
    const bad = await call(ctx, 'PUT', `/messages/${m.id}/reactions`, {
      cookie: bia.cookie,
      body: { emoji: '💩' },
    });
    expect(bad.status).toBe(400);
    const outsider = await signedIn(ctx, { username: 'fora' });
    const denied = await call(ctx, 'PUT', `/messages/${m.id}/reactions`, {
      cookie: outsider.cookie,
      body: { emoji: '👍' },
    });
    expect(denied.status).toBe(404);
  });
});

describe('menções', () => {
  it('menciona quem é membro e aparece no texto; alimenta contador e aba Menções', async () => {
    const { ana, bia, caio, g } = await group();
    const outsider = await signedIn(ctx, { username: 'fora', displayName: 'Fulano Fora' });
    const m = await send(ana.cookie, g.id, {
      body: '@Bia Souza pode ver isso? (o Caio não foi citado)',
      mentions: [bia.user.id, caio.user.id, outsider.user.id],
    });
    expect(m.body!.mentions).toEqual([bia.user.id]);

    const biaSummary = (await list(bia.cookie)).find((c) => c.id === g.id)!;
    const caioSummary = (await list(caio.cookie)).find((c) => c.id === g.id)!;
    expect(biaSummary.unreadMentions).toBe(1);
    expect(caioSummary.unreadMentions).toBe(0);

    const tab = await call(ctx, 'GET', '/mentions', { cookie: bia.cookie });
    expect(tab.body!.items).toEqual([
      expect.objectContaining({
        unread: true,
        conversation: { id: g.id, type: 'group', title: 'Projeto' },
        message: expect.objectContaining({ id: m.body!.id }),
      }),
    ]);
    await call(ctx, 'POST', `/conversations/${g.id}/read`, {
      cookie: bia.cookie,
      body: { seq: m.body!.seq },
    });
    expect((await list(bia.cookie)).find((c) => c.id === g.id)!.unreadMentions).toBe(0);
    expect(
      (await call(ctx, 'GET', '/mentions', { cookie: bia.cookie })).body!.items[0].unread,
    ).toBe(false);
  });

  it('editar e tirar o nome do texto remove a menção', async () => {
    const { ana, bia, g } = await group();
    const m = (await send(ana.cookie, g.id, { body: 'Oi @Bia Souza', mentions: [bia.user.id] }))
      .body!;
    const e = await call(ctx, 'PATCH', `/messages/${m.id}`, {
      cookie: ana.cookie,
      body: { body: 'Oi pessoal' },
    });
    expect(e.body!.mentions).toEqual([]);
    expect((await call(ctx, 'GET', '/mentions', { cookie: bia.cookie })).body!.items).toEqual([]);
  });

  it('@todos vale em grupos pequenos; em grupos grandes, só para administradores', async () => {
    const small = await group();
    const m = await send(small.bia.cookie, small.g.id, {
      body: '@todos reunião!',
      mentionAll: true,
    });
    expect(m.body!.mentionsAll).toBe(true);
    expect((await list(small.caio.cookie)).find((c) => c.id === small.g.id)!.unreadMentions).toBe(
      1,
    );

    await resetState(ctx);
    const big = await group(50);
    const denied = await send(big.bia.cookie, big.g.id, { body: '@todos oi', mentionAll: true });
    expect(denied.status).toBe(403);
    const owner = await send(big.ana.cookie, big.g.id, { body: '@todos oi', mentionAll: true });
    expect(owner.body!.mentionsAll).toBe(true);
    // Sem "@todos" no texto, a marcação é ignorada.
    const silent = await send(big.ana.cookie, big.g.id, { body: 'oi', mentionAll: true });
    expect(silent.body!.mentionsAll).toBe(false);
  });
});

describe('aba Menções', () => {
  it('pagina pelas mais antigas', async () => {
    const { ana, bia, g } = await group();
    for (let i = 0; i < 3; i++)
      await send(ana.cookie, g.id, { body: `@Bia Souza item ${i}`, mentions: [bia.user.id] });
    const p1 = (await call(ctx, 'GET', '/mentions?limit=2', { cookie: bia.cookie })).body!;
    expect(p1.hasMore).toBe(true);
    const before = encodeURIComponent(p1.items[1].message.createdAt);
    const p2 = await call(ctx, 'GET', `/mentions?limit=2&before=${before}`, { cookie: bia.cookie });
    expect(p2.status).toBe(200);
    expect(p2.body!.items).toHaveLength(1);
  });
});
