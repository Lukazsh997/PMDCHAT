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

describe('threads', () => {
  it('respostas ficam na thread, contam na raiz e não entram na linha do tempo', async () => {
    const { ana, bia, g } = await group();
    const root = (await send(ana.cookie, g.id, { body: 'Quem revisa o edital?' })).body!;
    const r1 = await send(bia.cookie, g.id, { body: 'Eu reviso.', threadRootId: root.id });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ threadRootId: root.id });
    await send(ana.cookie, g.id, { body: 'Obrigada!', threadRootId: root.id });

    const thread = await call(ctx, 'GET', `/messages/${root.id}/thread`, { cookie: bia.cookie });
    expect(thread.body!.root).toMatchObject({ id: root.id, replyCount: 2 });
    expect(thread.body!.replies.map((m: { body: string }) => m.body)).toEqual([
      'Eu reviso.',
      'Obrigada!',
    ]);
    // Abrir pela resposta leva à mesma thread.
    const viaReply = await call(ctx, 'GET', `/messages/${r1.body!.id}/thread`, {
      cookie: bia.cookie,
    });
    expect(viaReply.body!.root.id).toBe(root.id);

    const timeline = await call(ctx, 'GET', `/conversations/${g.id}/messages`, {
      cookie: bia.cookie,
    });
    const texts = timeline
      .body!.items.filter((m: { type: string }) => m.type === 'text')
      .map((m: { body: string }) => m.body);
    expect(texts).toEqual(['Quem revisa o edital?']);
    // A última mensagem da lista e as não lidas ignoram respostas de thread.
    const caioList = await list((await signedIn(ctx, { username: 'zeca' })).cookie);
    expect(caioList).toEqual([]);
    const biaSummary = (await list(bia.cookie)).find((c) => c.id === g.id)!;
    expect(biaSummary.lastMessage.text).toBe('Quem revisa o edital?');
  });

  it('não aceita resposta a resposta nem thread de outra conversa', async () => {
    const { ana, bia, g } = await group();
    const root = (await send(ana.cookie, g.id, { body: 'raiz' })).body!;
    const reply = (await send(bia.cookie, g.id, { body: 'resp', threadRootId: root.id })).body!;
    expect((await send(ana.cookie, g.id, { body: 'x', threadRootId: reply.id })).status).toBe(404);
    const other = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    expect((await send(ana.cookie, other.id, { body: 'x', threadRootId: root.id })).status).toBe(
      404,
    );
  });
});

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
