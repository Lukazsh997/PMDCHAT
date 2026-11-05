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
  it('cada pessoa tem uma reação por mensagem: outro emoji troca, o mesmo tira', async () => {
    const { ana, bia, caio, g } = await group();
    const m = (await send(ana.cookie, g.id, { body: 'Aprovado!' })).body!;
    const react = (cookie: string, emoji: string) =>
      call(ctx, 'PUT', `/messages/${m.id}/reactions`, { cookie, body: { emoji } });
    await react(bia.cookie, '👍');
    await react(caio.cookie, '👍');
    // Repetir não duplica.
    let r = await react(caio.cookie, '👍');
    expect(r.body!.reactions).toEqual([{ emoji: '👍', userIds: [bia.user.id, caio.user.id] }]);

    // Outro emoji substitui o anterior: o Caio passa de 👍 para ❤️.
    r = await react(caio.cookie, '❤️');
    expect(r.body!.reactions).toEqual([
      { emoji: '👍', userIds: [bia.user.id] },
      { emoji: '❤️', userIds: [caio.user.id] },
    ]);

    // Tirar só vale para o emoji atual.
    const stale = await call(ctx, 'DELETE', `/messages/${m.id}/reactions`, {
      cookie: caio.cookie,
      body: { emoji: '👍' },
    });
    expect(stale.body!.reactions).toHaveLength(2);
    const off = await call(ctx, 'DELETE', `/messages/${m.id}/reactions`, {
      cookie: bia.cookie,
      body: { emoji: '👍' },
    });
    expect(off.body!.reactions).toEqual([{ emoji: '❤️', userIds: [caio.user.id] }]);

    const bad = await react(bia.cookie, '💩');
    expect(bad.status).toBe(400);
    const outsider = await signedIn(ctx, { username: 'fora' });
    expect((await react(outsider.cookie, '👍')).status).toBe(404);
  });
});

describe('sem menções', () => {
  it('"@Nome" é só texto: não há aba Menções nem contador', async () => {
    const { ana, bia, g } = await group();
    const m = await send(ana.cookie, g.id, {
      body: '@Bia Souza pode ver isso?',
      mentions: [bia.user.id],
      mentionAll: true,
    });
    expect(m.status).toBe(201);
    expect(m.body).not.toHaveProperty('mentions');
    expect(m.body).not.toHaveProperty('mentionsAll');
    const summary = (await list(bia.cookie)).find((c) => c.id === g.id)!;
    expect(summary).not.toHaveProperty('unreadMentions');
    expect(summary.unreadCount).toBe(1);
    expect((await call(ctx, 'GET', '/mentions', { cookie: bia.cookie })).status).toBe(404);
  });
});
