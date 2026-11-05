import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { FILE_RULES, type UploadedFile } from '@plataforma/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { clientInfo, CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthContext } from '../auth/index.js';
import { FilesService } from './files.service.js';

const uuidParam = new ZodPipe(z.uuid());
const downloadQuery = new ZodPipe(z.object({ download: z.enum(['1']).optional() }));
/** Tipos que o Chrome exibe com segurança; o resto sempre é baixado. */
const INLINE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<UploadedFile> {
    if (!req.isMultipart()) {
      throw new AppException(400, 'VALIDATION_FAILED', 'Envie o arquivo como multipart/form-data.');
    }
    const part = await req.file({ limits: { fileSize: FILE_RULES.maxSizeBytes, files: 1 } });
    if (!part) throw new AppException(400, 'VALIDATION_FAILED', 'Nenhum arquivo recebido.');
    return this.files.upload(auth.user.id, part.filename, part.file, clientInfo(req));
  }

  @Get(':id')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidParam) id: string,
    @Query(downloadQuery) q: { download?: '1' },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const f = await this.files.getForUser(auth.user.id, id);
    const inline = INLINE.has(f.mimeType) && !q.download;
    await this.send(
      reply,
      this.files.pathOf(f.storageKey),
      f.mimeType,
      f.sizeBytes,
      f.originalName,
      inline,
    );
  }

  @Get(':id/thumbnail')
  async thumbnail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidParam) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const f = await this.files.getForUser(auth.user.id, id);
    if (!f.thumbnailKey) throw new AppException(404, 'NOT_FOUND', 'Miniatura não disponível');
    await this.send(
      reply,
      this.files.pathOf(f.thumbnailKey),
      'image/webp',
      undefined,
      `${f.originalName}.webp`,
      true,
    );
  }

  private async send(
    reply: FastifyReply,
    path: string,
    type: string,
    size: number | undefined,
    name: string,
    inline: boolean,
  ) {
    const encoded = encodeURIComponent(name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16)}`,
    );
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    void reply
      .header('content-type', type)
      .header(
        'content-disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      )
      .header('cache-control', 'private, max-age=86400, immutable')
      .header(
        'content-security-policy',
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      )
      .header('x-content-type-options', 'nosniff');
    if (size !== undefined) void reply.header('content-length', String(size));
    await reply.send(createReadStream(path));
  }
}
