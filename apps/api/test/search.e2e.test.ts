import { SEARCH_MARK } from '@plataforma/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
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
const cid = () => `s-${Date.now()}-${n++}`;
const send = (cookie: string, conversationId: string, body: string, extra = {}) =>
  call(ctx, 'POST', `/conversations/${conversationId}/messages`, {
    cookie,
    body: { clientId: cid(), body, ...extra },
  });
const search = async (cookie: string, qs: string) =>
  (await call(ctx, 'GET', `/search/messages?${qs}`, { cookie })).body!;

async function setup() {
  const ana = await signedIn(ctx, { username: 'ana', displayName: 'Ana Lima' });
  const bia = await signedIn(ctx, { username: 'bia', displayName: 'Bia Souza' });
  const caio = await signedIn(ctx, { username: 'caio', displayName: 'Caio Melo' });
  const direct = (
    await call(ctx, 'POST', '/conversations/direct', {
      cookie: ana.cookie,
      body: { userId: bia.user.id },
    })
  ).body!;
  const group = (
    await call(ctx, 'POST', '/conversations/group', {
      cookie: bia.cookie,
      body: { name: 'Licitações', memberIds: [caio.user.id] },
    })
  ).body!;
  return { ana, bia, caio, direct, group };
}

describe('busca de mensagens', () => {
  it('ignora acentos, aceita palavras parciais e destaca os termos', async () => {
    const { ana, bia, direct } = await setup();
    await send(ana.cookie, direct.id, 'A reunião da Secretária de Administração foi adiada.');
    await send(ana.cookie, direct.id, 'Outro assunto qualquer.');

    const r = await search(bia.cookie, 'q=secretaria%20reuni');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      conversation: { id: direct.id, type: 'direct', title: 'Ana Lima' },
      senderName: 'Ana Lima',
    });
    expect(r.items[0].snippet).toContain(`${SEARCH_MARK.start}Secretária${SEARCH_MARK.end}`);
    expect((await search(bia.cookie, 'q=inexistente')).items).toEqual([]);
  });

  it('só encontra o que a pessoa pode ler', async () => {
    const { ana, bia, caio, direct, group } = await setup();
    await send(ana.cookie, direct.id, 'edital sigiloso entre Ana e Bia');
    await send(bia.cookie, group.id, 'edital publicado no grupo');
    const m = (await send(bia.cookie, group.id, 'edital que vai ser apagado')).body!;
    await call(ctx, 'DELETE', `/messages/${m.id}`, { cookie: bia.cookie });

    const caioHits = await search(caio.cookie, 'q=edital');
    expect(caioHits.items.map((i: { message: { body: string } }) => i.message.body)).toEqual([
      'edital publicado no grupo',
    ]);
    // Quem entra no grupo depois não encontra o histórico anterior.
    const dani = await signedIn(ctx, { username: 'dani', displayName: 'Dani Reis' });
    await call(ctx, 'POST', `/conversations/${group.id}/members`, {
      cookie: bia.cookie,
      body: { userIds: [dani.user.id] },
    });
    expect((await search(dani.cookie, 'q=edital')).items).toEqual([]);
    expect((await search(ana.cookie, 'q=edital')).items).toHaveLength(1);
  });

  it('filtra por conversa, por pessoa e por período, e pagina', async () => {
    const { ana, bia, direct, group } = await setup();
    for (let i = 0; i < 3; i++) await send(ana.cookie, direct.id, `relatório mensal ${i}`);
    await send(bia.cookie, direct.id, 'relatório da Bia');
    await send(bia.cookie, group.id, 'relatório do grupo');

    expect((await search(bia.cookie, `q=relatorio&conversationId=${group.id}`)).items).toHaveLength(
      1,
    );
    expect((await search(bia.cookie, `q=relatorio&senderId=${ana.user.id}`)).items).toHaveLength(3);
    const today = new Date().toISOString().slice(0, 10);
    expect((await search(bia.cookie, `q=relatorio&from=${today}&to=${today}`)).items).toHaveLength(
      5,
    );
    expect((await search(bia.cookie, 'q=relatorio&to=2020-01-01')).items).toEqual([]);

    const p1 = await search(bia.cookie, 'q=relatorio&limit=2');
    expect(p1.hasMore).toBe(true);
    const before = encodeURIComponent(p1.items[1].message.createdAt);
    const p2 = await search(bia.cookie, `q=relatorio&limit=10&before=${before}`);
    expect(p2).toMatchObject({ hasMore: false });
    expect(p2.items).toHaveLength(3);
    const ids = [...p1.items, ...p2.items].map((i: { message: { id: string } }) => i.message.id);
    expect(new Set(ids).size).toBe(5);
  });
});

describe('busca de arquivos e navegação', () => {
  it('encontra arquivos pelo nome, só nas conversas da pessoa', async () => {
    const { ana, bia, caio, direct } = await setup();
    const f = await call(ctx, 'POST', '/files', {
      cookie: ana.cookie,
      ...multipart('Relatório Anual 2026.txt', Buffer.from('conteúdo'), 'text/plain'),
    });
    await send(ana.cookie, direct.id, '', { attachmentIds: [f.body!.id] });
    const hits = (
      await call(ctx, 'GET', '/search/files?q=relatorio%20anual', { cookie: bia.cookie })
    ).body as unknown as Record<string, any>[];
    expect(hits).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ name: 'Relatório Anual 2026.txt' }),
        conversation: { id: direct.id, type: 'direct', title: 'Ana Lima' },
        senderName: 'Ana Lima',
      }),
    ]);
    expect(
      (await call(ctx, 'GET', '/search/files?q=relatorio', { cookie: caio.cookie })).body,
    ).toEqual([]);
  });

  it('abre a conversa ao redor de uma mensagem antiga', async () => {
    const { ana, bia, direct } = await setup();
    const sent: { seq: number }[] = [];
    for (let i = 0; i < 30; i++)
      sent.push((await send(ana.cookie, direct.id, `msg ${i}`)).body! as { seq: number });
    const target = sent[10]!;
    const page = (
      await call(ctx, 'GET', `/conversations/${direct.id}/messages?around=${target.seq}&limit=10`, {
        cookie: bia.cookie,
      })
    ).body!;
    const seqs = page.items.map((m: { seq: number }) => m.seq);
    expect(seqs).toContain(target.seq);
    expect(seqs).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.hasNewer).toBe(true);
  });
});
