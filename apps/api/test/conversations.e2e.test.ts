import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { messages } from '../src/database/schema/index.js';
import { maintenanceJobs } from '../src/jobs/maintenance.js';
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
const cid = () => `cliente-${Date.now()}-${n++}`;
const people = async () => {
  const ana = await signedIn(ctx, { username: 'ana', displayName: 'Ana Lima' });
  const bia = await signedIn(ctx, { username: 'bia', displayName: 'Bia Souza' });
  const caio = await signedIn(ctx, { username: 'caio', displayName: 'Caio Melo' });
  return { ana, bia, caio };
};
const send = (cookie: string, conversationId: string, body: string, clientId = cid()) =>
  call(ctx, 'POST', `/conversations/${conversationId}/messages`, {
    cookie,
    body: { clientId, body },
  });

describe('conversas diretas', () => {
  it('abre uma única conversa por par, que só aparece para a outra pessoa após a primeira mensagem', async () => {
    const { ana, bia } = await people();
    const a = await call(ctx, 'POST', '/conversations/direct', {
      cookie: ana.cookie,
      body: { userId: bia.user.id },
    });
    const again = await call(ctx, 'POST', '/conversations/direct', {
      cookie: ana.cookie,
      body: { userId: bia.user.id },
    });
    const fromBia = await call(ctx, 'POST', '/conversations/direct', {
      cookie: bia.cookie,
      body: { userId: ana.user.id },
    });
    expect(a.body?.id).toBe(again.body?.id);
    expect(fromBia.body?.id).toBe(a.body?.id);
    expect(a.body).toMatchObject({ type: 'direct', title: 'Bia Souza', peer: { username: 'bia' } });

    await resetState(ctx);
    const p = await people();
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: p.ana.cookie,
        body: { userId: p.bia.user.id },
      })
    ).body!;
    expect((await call(ctx, 'GET', '/conversations', { cookie: p.bia.cookie })).body).toEqual([]);
    await send(p.ana.cookie, conv.id, 'Bom dia!');
    const list = (await call(ctx, 'GET', '/conversations', { cookie: p.bia.cookie }))
      .body as unknown as Record<string, any>[];
    expect(list).toEqual([
      expect.objectContaining({
        title: 'Ana Lima',
        unreadCount: 1,
        lastMessage: expect.objectContaining({ text: 'Bom dia!', senderName: 'Ana Lima' }),
      }),
    ]);
  });

  it('envio é idempotente, as mensagens saem em ordem e a leitura zera as não lidas', async () => {
    const { ana, bia } = await people();
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    const first = await send(ana.cookie, conv.id, 'Olá', 'fixo-12345678');
    const retry = await send(ana.cookie, conv.id, 'Olá', 'fixo-12345678');
    expect(retry.body?.id).toBe(first.body?.id);
    await Promise.all(['1', '2', '3'].map((t) => send(ana.cookie, conv.id, t)));

    const page = await call(ctx, 'GET', `/conversations/${conv.id}/messages`, {
      cookie: bia.cookie,
    });
    expect(page.body?.items.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(
      (await call(ctx, 'GET', '/conversations', { cookie: bia.cookie })).body?.[0].unreadCount,
    ).toBe(4);

    await call(ctx, 'POST', `/conversations/${conv.id}/read`, {
      cookie: bia.cookie,
      body: { seq: 4 },
    });
    expect(
      (await call(ctx, 'GET', '/conversations', { cookie: bia.cookie })).body?.[0].unreadCount,
    ).toBe(0);
    const older = await call(ctx, 'GET', `/conversations/${conv.id}/messages?before=3&limit=1`, {
      cookie: bia.cookie,
    });
    expect(older.body).toMatchObject({
      items: [expect.objectContaining({ seq: 2 })],
      hasMore: true,
    });
  });

  it('quem não participa não vê a conversa nem as mensagens', async () => {
    const { ana, bia, caio } = await people();
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    expect(
      (await call(ctx, 'GET', `/conversations/${conv.id}/messages`, { cookie: caio.cookie }))
        .status,
    ).toBe(404);
    expect((await send(caio.cookie, conv.id, 'intruso')).status).toBe(404);
  });

  it('rejeita mensagem vazia', async () => {
    const { ana, bia } = await people();
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    expect((await send(ana.cookie, conv.id, '   \n ')).status).toBe(400);
  });
});

describe('edição e exclusão', () => {
  it('edita até 15 minutos, guardando o texto anterior', async () => {
    const { ana, bia } = await people();
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    const msg = (await send(ana.cookie, conv.id, 'reunião às 14h')).body!;
    expect(
      (
        await call(ctx, 'PATCH', `/messages/${msg.id}`, {
          cookie: bia.cookie,
          body: { body: 'hack' },
        })
      ).status,
    ).toBe(403);
    const edited = await call(ctx, 'PATCH', `/messages/${msg.id}`, {
      cookie: ana.cookie,
      body: { body: 'reunião às 15h' },
    });
    expect(edited.body).toMatchObject({ body: 'reunião às 15h', editedAt: expect.any(String) });

    await ctx.db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(messages.id, msg.id));
    const late = await call(ctx, 'PATCH', `/messages/${msg.id}`, {
      cookie: ana.cookie,
      body: { body: 'tarde demais' },
    });
    expect(late.status).toBe(409);
  });

  it('apagar esconde o conteúdo na hora e a purga remove em definitivo após 48 h', async () => {
    const { ana, bia } = await people();
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    const msg = (await send(ana.cookie, conv.id, 'informação sigilosa')).body!;
    expect((await call(ctx, 'DELETE', `/messages/${msg.id}`, { cookie: bia.cookie })).status).toBe(
      403,
    );
    const del = await call(ctx, 'DELETE', `/messages/${msg.id}`, { cookie: ana.cookie });
    expect(del.body).toMatchObject({ body: '', deletedAt: expect.any(String) });
    const page = await call(ctx, 'GET', `/conversations/${conv.id}/messages`, {
      cookie: bia.cookie,
    });
    expect(page.body?.items[0]).toMatchObject({ body: '', deletedAt: expect.any(String) });

    // Ainda dentro das 48 h: o texto fica guardado no banco (exclusão lógica).
    await maintenanceJobs['messages.purge']({ db: ctx.db, filesDir: '/tmp/plataforma-test-files' });
    let [row] = await ctx.db.select().from(messages).where(eq(messages.id, msg.id));
    expect(row!.body).toBe('informação sigilosa');

    await ctx.db
      .update(messages)
      .set({ deletedAt: new Date(Date.now() - 49 * 3_600_000) })
      .where(eq(messages.id, msg.id));
    const r = await maintenanceJobs['messages.purge']({
      db: ctx.db,
      filesDir: '/tmp/plataforma-test-files',
    });
    expect(r.purged).toBe(1);
    [row] = await ctx.db.select().from(messages).where(eq(messages.id, msg.id));
    expect(row).toMatchObject({ body: '', purgedAt: expect.any(Date) });
  });

  it('moderador apaga mensagem de qualquer pessoa', async () => {
    const { ana, bia } = await people();
    const mod = await signedIn(ctx, { username: 'moderador', role: 'moderator' });
    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: mod.user.id },
      })
    ).body!;
    const msg = (await send(ana.cookie, conv.id, 'conteúdo impróprio')).body!;
    expect((await call(ctx, 'DELETE', `/messages/${msg.id}`, { cookie: mod.cookie })).status).toBe(
      200,
    );
    void bia;
  });
});

describe('grupos', () => {
  it('cria grupo, adiciona e remove pessoas com mensagens de sistema', async () => {
    const { ana, bia, caio } = await people();
    const g = await call(ctx, 'POST', '/conversations/group', {
      cookie: ana.cookie,
      body: { name: 'Equipe de Projetos', memberIds: [bia.user.id] },
    });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({
      type: 'group',
      title: 'Equipe de Projetos',
      memberCount: 2,
      myRole: 'owner',
    });

    await send(ana.cookie, g.body!.id, 'mensagem antiga');
    expect(
      (
        await call(ctx, 'POST', `/conversations/${g.body!.id}/members`, {
          cookie: bia.cookie,
          body: { userIds: [caio.user.id] },
        })
      ).status,
    ).toBe(403);
    const added = await call(ctx, 'POST', `/conversations/${g.body!.id}/members`, {
      cookie: ana.cookie,
      body: { userIds: [caio.user.id] },
    });
    expect(
      added.body?.members.map((m: { username: string; role: string }) => `${m.username}:${m.role}`),
    ).toEqual(['ana:owner', 'bia:member', 'caio:member']);

    // Quem entra depois não vê o histórico anterior.
    const caioView = await call(ctx, 'GET', `/conversations/${g.body!.id}/messages`, {
      cookie: caio.cookie,
    });
    expect(caioView.body?.items).toEqual([
      expect.objectContaining({
        type: 'system',
        system: expect.objectContaining({ event: 'members_added', names: ['Caio Melo'] }),
      }),
    ]);

    await call(ctx, 'DELETE', `/conversations/${g.body!.id}/members/${bia.user.id}`, {
      cookie: ana.cookie,
    });
    expect(
      (await call(ctx, 'GET', `/conversations/${g.body!.id}/messages`, { cookie: bia.cookie }))
        .status,
    ).toBe(404);
  });

  it('quando o dono sai, a posse passa a um administrador', async () => {
    const { ana, bia, caio } = await people();
    const g = (
      await call(ctx, 'POST', '/conversations/group', {
        cookie: ana.cookie,
        body: { name: 'Comissão', memberIds: [bia.user.id, caio.user.id] },
      })
    ).body!;
    await call(ctx, 'PUT', `/conversations/${g.id}/members/${caio.user.id}/role`, {
      cookie: ana.cookie,
      body: { role: 'admin' },
    });
    expect(
      (
        await call(ctx, 'DELETE', `/conversations/${g.id}/members/${ana.user.id}`, {
          cookie: ana.cookie,
        })
      ).status,
    ).toBe(204);
    const d = await call(ctx, 'GET', `/conversations/${g.id}`, { cookie: bia.cookie });
    expect(
      d.body?.members.map((m: { username: string; role: string }) => `${m.username}:${m.role}`),
    ).toEqual(['caio:owner', 'bia:member']);
  });

  it('administrador do grupo apaga mensagens de outros; membro comum não', async () => {
    const { ana, bia, caio } = await people();
    const g = (
      await call(ctx, 'POST', '/conversations/group', {
        cookie: ana.cookie,
        body: { name: 'Avisos', memberIds: [bia.user.id, caio.user.id] },
      })
    ).body!;
    const m = (await send(bia.cookie, g.id, 'spam')).body!;
    expect((await call(ctx, 'DELETE', `/messages/${m.id}`, { cookie: caio.cookie })).status).toBe(
      403,
    );
    expect((await call(ctx, 'DELETE', `/messages/${m.id}`, { cookie: ana.cookie })).status).toBe(
      200,
    );
  });

  it('silenciar fica salvo para o usuário', async () => {
    const { ana, bia } = await people();
    const g = (
      await call(ctx, 'POST', '/conversations/group', {
        cookie: ana.cookie,
        body: { name: 'Geral', memberIds: [bia.user.id] },
      })
    ).body!;
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const res = await call(ctx, 'PATCH', `/conversations/${g.id}/me`, {
      cookie: bia.cookie,
      body: { mutedUntil: until },
    });
    expect(res.body?.mutedUntil).toBe(until);
  });
});

describe('convidados e diretório', () => {
  it('convidado não busca pessoas nem cria conversas, mas participa quando incluído', async () => {
    const { ana } = await people();
    const guest = await signedIn(ctx, {
      username: 'externo',
      displayName: 'Consultor Externo',
      kind: 'guest',
      accessExpiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(
      (await call(ctx, 'GET', '/directory/users?q=ana', { cookie: guest.cookie })).status,
    ).toBe(403);
    expect(
      (
        await call(ctx, 'POST', '/conversations/direct', {
          cookie: guest.cookie,
          body: { userId: ana.user.id },
        })
      ).status,
    ).toBe(403);

    const g = (
      await call(ctx, 'POST', '/conversations/group', {
        cookie: ana.cookie,
        body: { name: 'Projeto com consultoria', memberIds: [guest.user.id] },
      })
    ).body!;
    expect((await send(guest.cookie, g.id, 'Olá a todos')).status).toBe(201);
  });

  it('busca pessoas ignorando acentos e sem incluir a si mesmo nem bloqueados', async () => {
    const { ana } = await people();
    await createUser(ctx, { username: 'joao', displayName: 'João Araújo' });
    const res = await call(ctx, 'GET', '/directory/users?q=joao araujo', { cookie: ana.cookie });
    expect(res.body?.map((u: { username: string }) => u.username)).toEqual(['joao']);
    const all = await call(ctx, 'GET', '/directory/users', { cookie: ana.cookie });
    expect(all.body?.map((u: { username: string }) => u.username)).not.toContain('ana');
  });
});
