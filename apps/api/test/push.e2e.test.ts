import type { PushPayload } from '@plataforma/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PushSubscriptionRow } from '../src/database/schema/index.js';
import { deliverPush } from '../src/jobs/push.js';
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
const cid = () => `p-${Date.now()}-${n++}`;
const sub = (i: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/teste-${i}`,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
});

/** Envio falso: guarda o que seria mandado ao serviço de push. */
function fakeSender(goneEndpoints: string[] = []) {
  const sent: { userId: string; payload: PushPayload }[] = [];
  const send = async (s: PushSubscriptionRow, payload: PushPayload) => {
    if (goneEndpoints.includes(s.endpoint)) return { ok: false, gone: true };
    sent.push({ userId: s.userId, payload });
    return { ok: true, gone: false };
  };
  return { sent, send };
}

async function setup() {
  const ana = await signedIn(ctx, { username: 'ana', displayName: 'Ana Lima' });
  const bia = await signedIn(ctx, { username: 'bia', displayName: 'Bia Souza' });
  const caio = await signedIn(ctx, { username: 'caio', displayName: 'Caio Melo' });
  const g = (
    await call(ctx, 'POST', '/conversations/group', {
      cookie: ana.cookie,
      body: { name: 'Projeto', memberIds: [bia.user.id, caio.user.id] },
    })
  ).body!;
  await call(ctx, 'POST', '/push/subscriptions', { cookie: bia.cookie, body: sub(1) });
  await call(ctx, 'POST', '/push/subscriptions', { cookie: caio.cookie, body: sub(2) });
  return { ana, bia, caio, g };
}
const send = (cookie: string, conversationId: string, body: Record<string, unknown>) =>
  call(ctx, 'POST', `/conversations/${conversationId}/messages`, {
    cookie,
    body: { clientId: cid(), ...body },
  });
const deliver = (messageId: string, userIds: string[], sender: ReturnType<typeof fakeSender>) =>
  deliverPush({ db: ctx.db, redis: ctx.redis }, { messageId, userIds }, sender.send);

describe('Web Push', () => {
  it('entrega a quem está sem aba aberta e não a quem está conectado', async () => {
    const { ana, bia, caio, g } = await setup();
    const cfg = await call(ctx, 'GET', '/push/config', { cookie: bia.cookie });
    expect(cfg.body).toMatchObject({ enabled: true, publicKey: expect.any(String) });

    // Caio está com a aba aberta.
    await ctx.redis.hset(`presence:sockets:${caio.user.id}`, 'sock1', 'online');
    const m = (await send(ana.cookie, g.id, { body: 'Reunião às 15h' })).body!;
    const s = fakeSender();
    const r = await deliver(m.id, [bia.user.id, caio.user.id], s);
    expect(r.sent).toBe(1);
    expect(s.sent).toEqual([
      {
        userId: bia.user.id,
        payload: {
          title: 'Ana Lima em Projeto',
          body: 'Reunião às 15h',
          url: `/c/${g.id}`,
          tag: g.id,
        },
      },
    ]);
  });

  it('respeita silenciar e o nível "só menções"', async () => {
    const { ana, bia, caio, g } = await setup();
    await call(ctx, 'PATCH', `/conversations/${g.id}/me`, {
      cookie: bia.cookie,
      body: { mutedUntil: new Date(Date.now() + 3_600_000).toISOString() },
    });
    const level = await call(ctx, 'PATCH', `/conversations/${g.id}/me`, {
      cookie: caio.cookie,
      body: { notificationLevel: 'mentions' },
    });
    expect(level.body).toMatchObject({
      notificationSetting: 'mentions',
      notificationLevel: 'mentions',
    });

    const plain = (await send(ana.cookie, g.id, { body: 'aviso comum' })).body!;
    const s1 = fakeSender();
    expect((await deliver(plain.id, [bia.user.id, caio.user.id], s1)).sent).toBe(0);

    // Menção fura o silêncio e o "só menções".
    const mention = (
      await send(ana.cookie, g.id, {
        body: '@Bia Souza e @Caio Melo, vejam',
        mentions: [bia.user.id, caio.user.id],
      })
    ).body!;
    const s2 = fakeSender();
    await deliver(mention.id, [bia.user.id, caio.user.id], s2);
    expect(s2.sent.map((x) => x.userId).sort()).toEqual([bia.user.id, caio.user.id].sort());
    expect(s2.sent[0]!.payload.title).toBe('Ana Lima mencionou você em Projeto');

    // Sem silêncio, quem avisa tudo recebe; quem escolheu "só menções" (Caio), não.
    await call(ctx, 'POST', '/push/subscriptions', { cookie: ana.cookie, body: sub(3) });
    const reply = (await send(bia.cookie, g.id, { body: 'Respondendo' })).body!;
    const s3 = fakeSender();
    await deliver(reply.id, [ana.user.id, caio.user.id], s3);
    expect(s3.sent.map((x) => x.userId)).toEqual([ana.user.id]);
    expect(s3.sent[0]!.payload).toMatchObject({
      title: 'Bia Souza em Projeto',
      url: `/c/${g.id}`,
    });
  });

  it('grupos grandes avisam só menções por padrão; inscrição recusada é apagada', async () => {
    const ana = await signedIn(ctx, { username: 'ana', displayName: 'Ana Lima' });
    const bia = await signedIn(ctx, { username: 'bia', displayName: 'Bia Souza' });
    const extra: string[] = [];
    for (let i = 0; i < 50; i++) extra.push((await createUser(ctx, { username: `x${i}` })).user.id);
    const g = (
      await call(ctx, 'POST', '/conversations/group', {
        cookie: ana.cookie,
        body: { name: 'Todos', memberIds: [bia.user.id, ...extra] },
      })
    ).body!;
    expect(g.notificationLevel).toBe('mentions');
    await call(ctx, 'POST', '/push/subscriptions', { cookie: bia.cookie, body: sub(9) });
    const m = (await send(ana.cookie, g.id, { body: 'oi' })).body!;
    const quiet = fakeSender();
    expect((await deliver(m.id, [bia.user.id], quiet)).sent).toBe(0);

    await call(ctx, 'PATCH', `/conversations/${g.id}/me`, {
      cookie: bia.cookie,
      body: { notificationLevel: 'all' },
    });
    const gone = fakeSender([sub(9).endpoint]);
    expect(await deliver(m.id, [bia.user.id], gone)).toMatchObject({ sent: 0, removed: 1 });
  });

  it('sair da sessão apaga a inscrição daquele navegador', async () => {
    const { bia } = await setup();
    await call(ctx, 'POST', '/auth/logout', { cookie: bia.cookie });
    await new Promise((r) => setTimeout(r, 100));
    const rows = await ctx.db.execute(
      sql`select count(*)::int as n from push_subscriptions where endpoint = ${sub(1).endpoint}`,
    );
    expect((rows as unknown as { n: number }[])[0]!.n).toBe(0);
  });
});
