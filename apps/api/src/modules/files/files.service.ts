import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { FILE_RULES, type UploadedFile } from '@plataforma/contracts';
import { and, eq, exists, gt, isNull, sql } from 'drizzle-orm';
import { fileTypeFromFile } from 'file-type';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import { AppException } from '../../common/app-exception.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { DB, type Database } from '../../database/database.js';
import {
  conversationMembers,
  files,
  type FileRow,
  messageAttachments,
  messages,
} from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import { AntivirusService, ScanUnavailableError } from './antivirus.service.js';

/** Formatos exibidos como imagem (SVG fica de fora: pode carregar scripts). */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const THUMB_MAX = 480;

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  readonly root: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DB) private readonly db: Database,
    private readonly antivirus: AntivirusService,
    private readonly audit: AuditService,
  ) {
    this.root = resolve(config.FILES_DIR);
  }

  async onModuleInit(): Promise<void> {
    await mkdir(join(this.root, 'tmp'), { recursive: true });
  }

  /** Recebe o arquivo, valida, verifica com o antivírus e grava. */
  async upload(
    uploaderId: string,
    originalName: string,
    stream: Readable & { truncated?: boolean },
    meta: { ip: string | null },
  ): Promise<UploadedFile> {
    const name = sanitizeName(originalName);
    const declaredExt = extname(name).slice(1).toLowerCase();
    if ((FILE_RULES.blockedExtensions as readonly string[]).includes(declaredExt)) {
      throw rejected(`Arquivos .${declaredExt} não são permitidos por segurança.`);
    }

    const tmp = join(this.root, 'tmp', randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    try {
      stream.on('data', (c: Buffer) => {
        size += c.length;
        hash.update(c);
      });
      await pipeline(stream, createWriteStream(tmp));
      if (stream.truncated) {
        throw rejected(`O arquivo passa do limite de ${FILE_RULES.maxSizeBytes / 1024 / 1024} MB.`);
      }
      if (size === 0) throw rejected('O arquivo está vazio.');

      // O tipo real vem do conteúdo, não do nome.
      const detected = await fileTypeFromFile(tmp);
      if (detected && (FILE_RULES.blockedExtensions as readonly string[]).includes(detected.ext)) {
        throw rejected('Arquivos executáveis não são permitidos por segurança.');
      }

      let scan;
      try {
        scan = await this.antivirus.scanFile(tmp);
      } catch (e) {
        if (e instanceof ScanUnavailableError) {
          throw new AppException(
            503,
            'SCAN_UNAVAILABLE',
            'A verificação antivírus está indisponível no momento. Tente novamente em instantes.',
          );
        }
        throw e;
      }
      if (scan.status === 'infected') {
        await this.audit.record({
          action: 'file.rejected',
          actorId: uploaderId,
          ip: meta.ip,
          metadata: { name, signature: scan.signature },
        });
        throw rejected(
          `O antivírus encontrou uma ameaça neste arquivo (${scan.signature}). Ele não foi enviado.`,
        );
      }

      const id = uuidv7();
      const now = new Date();
      const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
      let mimeType = detected?.mime ?? guessTextMime(declaredExt);
      let isImage = IMAGE_TYPES.has(mimeType);
      let width: number | null = null;
      let height: number | null = null;
      let thumbnailKey: string | null = null;

      if (isImage) {
        try {
          const processed = await this.processImage(tmp, mimeType, `${storageKey}.thumb`);
          ({ width, height } = processed);
          thumbnailKey = `${storageKey}.thumb`;
          size = (await stat(tmp)).size;
        } catch (err) {
          this.logger.warn(`Imagem inválida (${name}): ${String(err)}`);
          isImage = false;
          mimeType = 'application/octet-stream';
        }
      }

      await this.move(tmp, storageKey);
      const [row] = await this.db
        .insert(files)
        .values({
          id,
          uploaderId,
          storageKey,
          thumbnailKey,
          originalName: name,
          mimeType,
          sizeBytes: size,
          sha256: hash.digest('hex'),
          isImage,
          width,
          height,
          scanStatus: scan.status,
        })
        .returning();
      return toUploaded(row!);
    } finally {
      await rm(tmp, { force: true });
    }
  }

  /** Arquivo, se o usuário puder vê-lo: quem enviou, ou membro da conversa onde foi anexado. */
  async getForUser(userId: string, fileId: string): Promise<FileRow> {
    const [row] = await this.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          sql`(${files.uploaderId} = ${userId} or ${exists(
            this.db
              .select({ one: sql`1` })
              .from(messageAttachments)
              .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
              .innerJoin(
                conversationMembers,
                and(
                  eq(conversationMembers.conversationId, messages.conversationId),
                  eq(conversationMembers.userId, userId),
                ),
              )
              .where(
                and(
                  eq(messageAttachments.fileId, files.id),
                  isNull(messages.deletedAt),
                  gt(messages.seq, conversationMembers.joinedSeq),
                ),
              ),
          )})`,
        ),
      )
      .limit(1);
    if (!row) throw new AppException(404, 'NOT_FOUND', 'Arquivo não encontrado');
    return row;
  }

  pathOf(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('Caminho inválido');
    return p;
  }

  async deleteStored(row: Pick<FileRow, 'id' | 'storageKey' | 'thumbnailKey'>): Promise<void> {
    await rm(this.pathOf(row.storageKey), { force: true });
    if (row.thumbnailKey) await rm(this.pathOf(row.thumbnailKey), { force: true });
    await this.db.delete(files).where(eq(files.id, row.id));
  }

  /** Corrige a orientação, remove metadados (EXIF com localização) e gera a miniatura. */
  private async processImage(path: string, mime: string, thumbKey: string) {
    const animated = mime === 'image/gif';
    const img = sharp(path, { animated, limitInputPixels: 100_000_000 });
    const meta = await img.metadata();
    if (!animated) {
      // Reencoda sem metadados; a orientação EXIF é aplicada aos pixels.
      const format = meta.format;
      const pipe = sharp(path).rotate();
      const buf = await (
        format === 'png'
          ? pipe.png()
          : format === 'webp'
            ? pipe.webp({ quality: 90 })
            : pipe.jpeg({ quality: 90, mozjpeg: true })
      ).toBuffer();
      await sharp(buf).toFile(path);
    }
    const thumbPath = this.pathOf(thumbKey);
    await mkdir(dirname(thumbPath), { recursive: true });
    await sharp(path, { animated: false })
      .rotate()
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(thumbPath);
    const rotated = !animated && (meta.orientation ?? 1) >= 5;
    return {
      width: (rotated ? meta.height : meta.width) ?? null,
      height: (rotated ? meta.width : meta.height) ?? null,
    };
  }

  private async move(tmp: string, key: string): Promise<void> {
    const dest = this.pathOf(key);
    await mkdir(dirname(dest), { recursive: true });
    await rename(tmp, dest);
  }
}

export function toUploaded(f: FileRow): UploadedFile {
  return {
    id: f.id,
    name: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    isImage: f.isImage,
    width: f.width,
    height: f.height,
  };
}

function rejected(message: string): AppException {
  return new AppException(422, 'FILE_REJECTED', message);
}

/** Remove caminhos e caracteres de controle do nome enviado pelo navegador. */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  const clean = base
    // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .trim()
    .slice(0, 200);
  return clean || 'arquivo';
}

function guessTextMime(ext: string): string {
  const map: Record<string, string> = {
    txt: 'text/plain',
    csv: 'text/csv',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
  };
  return map[ext] ?? 'application/octet-stream';
}
