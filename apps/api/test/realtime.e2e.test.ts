import type { ClientToServerEvents, ServerToClientEvents } from '@plataforma/contracts';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, resetState, signedIn, startTestApp, type TestContext } from './helpers.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
let ctx: TestContext;
let url = '';
const sockets: Client[] = [];

beforeAll(async () => {
  ctx = await startTestApp();
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  url = await ctx.app.getUrl();
});
afterAll(async () => ctx.app.close());
beforeEach(async () => resetState(ctx));
afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));

function connect(cookie: string, origin = url): Promise<Client> {
  const s: Client = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: { cookie, origin },
    reconnection: false,
    forceNew: true,
  });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

const next = <E extends keyof ServerToClientEvents>(s: Client, event: E, ms = 3000) =>
  new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sem evento ${event}`)), ms);
    s.once(event, ((p: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(t);
      resolve(p);
    }) as never);
  });

describe('tempo real', () => {
  it('recusa conexão sem sessão ou de outra origem', async () => {
    await expect(connect('plataforma_sid=invalido')).rejects.toThrow(/UNAUTHENTICATED/);
    const { cookie } = await signedIn(ctx);
    await expect(connect(cookie, 'http://site-malicioso.test')).rejects.toThrow();
  });

  it('entrega mensagens, leitura e digitação em tempo real', async () => {
    const ana = await signedIn(ctx, { username: 'ana', displayName: 'Ana Lima' });
    const bia = await signedIn(ctx, { username: 'bia', displayName: 'Bia Souza' });
    const sa = await connect(ana.cookie);
    const sb = await connect(bia.cookie);
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;

    const incoming = next(sb, 'message.new');
    const echo = next(sa, 'message.new');
    await call(ctx, 'POST', `/conversations/${conv.id}/messages`, {
      cookie: ana.cookie,
      body: { clientId: 'rt-00000001', body: 'Chegou?' },
    });
    expect(await incoming).toMatchObject({
      body: 'Chegou?',
      senderId: ana.user.id,
      conversationId: conv.id,
    });
    expect((await echo).clientId).toBe('rt-00000001');

    const read = next(sa, 'read.updated');
    await call(ctx, 'POST', `/conversations/${conv.id}/read`, {
      cookie: bia.cookie,
      body: { seq: 1 },
    });
    expect(await read).toEqual({ conversationId: conv.id, userId: bia.user.id, seq: 1 });

    const typing = next(sa, 'typing');
    sb.emit('typing', { conversationId: conv.id });
    expect(await typing).toEqual({ conversationId: conv.id, userId: bia.user.id });
  });

  it('não repassa digitação de quem não participa da conversa', async () => {
    const ana = await signedIn(ctx, { username: 'ana' });
    const bia = await signedIn(ctx, { username: 'bia' });
    const caio = await signedIn(ctx, { username: 'caio' });
    const sa = await connect(ana.cookie);
    const sc = await connect(caio.cookie);
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    sc.emit('typing', { conversationId: conv.id });
    await expect(next(sa, 'typing', 500)).rejects.toThrow(/sem evento/);
  });

  it('avisa entrada em grupo e mudanças de presença', async () => {
    const ana = await signedIn(ctx, { username: 'ana' });
    const bia = await signedIn(ctx, { username: 'bia' });
    const sb = await connect(bia.cookie);
    const added = next(sb, 'conversation.updated');
    await call(ctx, 'POST', '/conversations/group', {
      cookie: ana.cookie,
      body: { name: 'Mutirão', memberIds: [bia.user.id] },
    });
    expect(await added).toMatchObject({ title: 'Mutirão', type: 'group', myRole: 'member' });

    const statuses = await new Promise<Record<string, string>>((r) =>
      sb.emit('presence.watch', { userIds: [ana.user.id] }, r),
    );
    expect(statuses[ana.user.id]).toBe('offline');
    const online = next(sb, 'presence.changed');
    const sa = await connect(ana.cookie);
    expect(await online).toEqual({ userId: ana.user.id, status: 'online' });
    const away = next(sb, 'presence.changed');
    sa.emit('presence.set', { status: 'away' });
    expect(await away).toEqual({ userId: ana.user.id, status: 'away' });
    const offline = next(sb, 'presence.changed');
    sa.disconnect();
    expect(await offline).toEqual({ userId: ana.user.id, status: 'offline' });
  });

  it('derruba a conexão quando a sessão é encerrada', async () => {
    const ana = await signedIn(ctx, { username: 'ana' });
    const sa = await connect(ana.cookie);
    const revoked = next(sa, 'session.revoked');
    const gone = new Promise((r) => sa.once('disconnect', r));
    await call(ctx, 'POST', '/auth/logout', { cookie: ana.cookie });
    await revoked;
    await gone;
  });
});
