import { Inject, Injectable } from '@nestjs/common';
import { AVATAR_RULES } from '@plataforma/contracts';
import { eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { AppException } from '../../common/app-exception.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { DB, type Database } from '../../database/database.js';
import { users } from '../../database/schema/index.js';

/**
 * Fotos de perfil. A imagem enviada é decodificada e redesenhada pelo sharp (quadrado
 * de 256 px, WebP, sem metadados): o arquivo gravado nunca é o que o navegador mandou.
 */
@Injectable()
export class AvatarService {
  private readonly root: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {
    this.root = resolve(config.FILES_DIR);
  }

  async replace(userId: string, stream: Readable & { truncated?: boolean }): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    if (stream.truncated) {
      throw invalid(`A foto passa do limite de ${AVATAR_RULES.maxSizeBytes / 1024 / 1024} MB.`);
    }
    const input = Buffer.concat(chunks);
    const type = await fileTypeFromBuffer(input);
    if (!type || !(AVATAR_RULES.acceptedTypes as readonly string[]).includes(type.mime)) {
      throw invalid('Envie uma foto em JPG, PNG ou WebP.');
    }
    let output: Buffer;
    try {
      output = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize(AVATAR_RULES.sizePx, AVATAR_RULES.sizePx, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw invalid('Não foi possível ler esta imagem. Tente outra foto.');
    }

    const key = `avatars/${userId}/${Date.now().toString(36)}.webp`;
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, output);
    const previous = await this.currentKey(userId);
    await this.db.update(users).set({ avatarKey: key }).where(eq(users.id, userId));
    if (previous) await rm(this.pathOf(previous), { force: true });
    return key;
  }

  /** Remove a foto. Devolve se havia uma. */
  async remove(userId: string): Promise<boolean> {
    const previous = await this.currentKey(userId);
    if (!previous) return false;
    await this.db.update(users).set({ avatarKey: null }).where(eq(users.id, userId));
    await rm(this.pathOf(previous), { force: true });
    return true;
  }

  async pathFor(userId: string): Promise<string | null> {
    const key = await this.currentKey(userId);
    return key ? this.pathOf(key) : null;
  }

  private async currentKey(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ key: users.avatarKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.key ?? null;
  }

  private pathOf(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('Caminho inválido');
    return p;
  }
}

const invalid = (message: string) => new AppException(422, 'FILE_REJECTED', message);
