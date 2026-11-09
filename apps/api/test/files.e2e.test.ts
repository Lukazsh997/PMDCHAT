import { eq } from 'drizzle-orm';
import { createServer, type Server } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/config.js';
import { files } from '../src/database/schema/index.js';
import { maintenanceJobs } from '../src/jobs/maintenance.js';
import { AntivirusService } from '../src/modules/files/antivirus.service.js';
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

const upload = (cookie: string, name: string, content: Buffer, type?: string) => {
  const m = multipart(name, content, type);
  return call(ctx, 'POST', '/files', { cookie, payload: m.payload, headers: m.headers });
};

async function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3a7' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Celular', Model: 'X1' },
      IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 32/1 0/1' },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe('upload de arquivos', () => {
  it('processa imagem: corrige orientação, remove metadados e gera miniatura', async () => {
    const { cookie } = await signedIn(ctx);
    const original = await photoWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const res = await upload(cookie, 'foto da obra.jpg', original, 'image/jpeg');
    expect(res.status).toBe(201);
    // Orientação 6 = girada 90°: as dimensões já vêm corrigidas.
    expect(res.body).toMatchObject({
      name: 'foto da obra.jpg',
      mimeType: 'image/jpeg',
      isImage: true,
      width: 800,
      height: 1200,
    });

    const file = await call(ctx, 'GET', `/files/${res.body!.id}`, { cookie });
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['content-disposition']).toMatch(/^inline;/);
    const meta = await sharp(file.raw).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation ?? 1).toBe(1);

    const thumb = await call(ctx, 'GET', `/files/${res.body!.id}/thumbnail`, { cookie });
    const t = await sharp(thumb.raw).metadata();
    expect(t.format).toBe('webp');
    expect(Math.max(t.width!, t.height!)).toBe(480);
  });

  it('bloqueia executáveis pelo nome e pelo conteúdo', async () => {
    const { cookie } = await signedIn(ctx);
    const byName = await upload(cookie, 'instalar.exe', Buffer.from('qualquer coisa'));
    expect(byName.status).toBe(422);
    expect(byName.body?.code).toBe('FILE_REJECTED');

    // Um executável do Windows disfarçado de PDF.
    const pe = Buffer.alloc(512);
    pe.write('MZ', 0);
    pe.writeUInt32LE(0x80, 0x3c);
    pe.write('PE\0\0', 0x80, 'binary');
    pe.writeUInt16LE(0x14c, 0x84);
    const disguised = await upload(cookie, 'relatorio.pdf', pe);
    expect(disguised.status).toBe(422);
  });

  it('documentos são baixados como anexo e só por quem pode vê-los', async () => {
    const { ana, bia, caio } = {
      ana: await signedIn(ctx, { username: 'ana' }),
      bia: await signedIn(ctx, { username: 'bia' }),
      caio: await signedIn(ctx, { username: 'caio' }),
    };
    const doc = (await upload(ana.cookie, 'planilha:final?.csv', Buffer.from('a;b\n1;2\n'))).body!;
    expect(doc).toMatchObject({ mimeType: 'text/csv', isImage: false });

    // Antes de anexar, só quem enviou acessa.
    expect((await call(ctx, 'GET', `/files/${doc.id}`, { cookie: bia.cookie })).status).toBe(404);

    const conv = (
      await call(ctx, 'POST', '/conversations/direct', {
        cookie: ana.cookie,
        body: { userId: bia.user.id },
      })
    ).body!;
    const msg = await call(ctx, 'POST', `/conversations/${conv.id}/messages`, {
      cookie: ana.cookie,
      body: { clientId: 'anexo-123456', body: '', attachmentIds: [doc.id] },
    });
    expect(msg.body?.attachments).toEqual([
      expect.objectContaining({ id: doc.id, name: 'planilhafinal.csv' }),
    ]);

    const got = await call(ctx, 'GET', `/files/${doc.id}`, { cookie: bia.cookie });
    expect(got.status).toBe(200);
    expect(got.headers['content-disposition']).toMatch(/^attachment;/);
    expect(got.headers['content-security-policy']).toContain('sandbox');
    expect((await call(ctx, 'GET', `/files/${doc.id}`, { cookie: caio.cookie })).status).toBe(404);

    // Um anexo não pode ser reaproveitado em outra mensagem.
    const reuse = await call(ctx, 'POST', `/conversations/${conv.id}/messages`, {
      cookie: ana.cookie,
      body: { clientId: 'anexo-654321', body: 'de novo', attachmentIds: [doc.id] },
    });
    expect(reuse.status).toBe(400);
  });

  it('descarta uploads nunca anexados depois de 24 h', async () => {
    const { cookie } = await signedIn(ctx);
    const f = (await upload(cookie, 'rascunho.txt', Buffer.from('oi'))).body!;
    await ctx.db
      .update(files)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(files.id, f.id));
    const r = await maintenanceJobs['files.orphans']({
      db: ctx.db,
      filesDir: '/tmp/plataforma-test-files',
    });
    expect(r.removed).toBe(1);
    expect((await call(ctx, 'GET', `/files/${f.id}`, { cookie })).status).toBe(404);
  });
});

describe('antivírus (protocolo clamd)', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    // clamd simulado: acusa qualquer conteúdo que contenha a assinatura de teste EICAR.
    server = createServer((sock) => {
      let data = Buffer.alloc(0);
      sock.on('data', (c) => {
        data = Buffer.concat([data, c]);
        if (data.subarray(-4).equals(Buffer.alloc(4))) {
          sock.end(
            data.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0',
          );
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const av = (p: number, required = true) =>
    new AntivirusService({
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: p,
      CLAMAV_REQUIRED: required,
    } as AppConfig);
  const tmp = async (content: string) => {
    const { writeFile } = await import('node:fs/promises');
    const p = `/tmp/av-${Math.random()}`;
    await writeFile(p, content);
    return p;
  };

  it('aprova arquivo limpo e acusa a ameaça', async () => {
    expect(await av(port).scanFile(await tmp('documento normal'))).toEqual({ status: 'clean' });
    expect(
      await av(port).scanFile(
        await tmp('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      ),
    ).toEqual({
      status: 'infected',
      signature: 'Eicar-Test-Signature',
    });
  });

  it('fora do ar: recusa quando obrigatório, deixa passar quando opcional', async () => {
    await expect(av(1).scanFile(await tmp('x'))).rejects.toThrow();
    expect(await av(1, false).scanFile(await tmp('x'))).toEqual({ status: 'skipped' });
  });
});
