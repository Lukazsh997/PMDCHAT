import { Controller, Delete, Get, HttpCode, Param, Put, Req, Res } from '@nestjs/common';
import { AVATAR_RULES, type PublicUser } from '@plataforma/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { clientInfo, CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AuditService } from '../audit/index.js';
import type { AuthContext } from '../auth/index.js';
import { AvatarService } from './avatar.service.js';
import { UsersService } from './users.service.js';

const uuidParam = new ZodPipe(z.uuid());

/** Foto de perfil: cada pessoa troca a própria; qualquer usuário logado pode vê-las. */
@Controller('users')
export class ProfileController {
  constructor(
    private readonly avatars: AvatarService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Put('me/avatar')
  async upload(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest): Promise<PublicUser> {
    if (!req.isMultipart()) {
      throw new AppException(400, 'VALIDATION_FAILED', 'Envie a foto como multipart/form-data.');
    }
    const part = await req.file({ limits: { fileSize: AVATAR_RULES.maxSizeBytes, files: 1 } });
    if (!part) throw new AppException(400, 'VALIDATION_FAILED', 'Nenhuma foto recebida.');
    await this.avatars.replace(auth.user.id, part.file);
    await this.audit.record({
      action: 'user.avatar_changed',
      actorId: auth.user.id,
      entityType: 'user',
      entityId: auth.user.id,
      ...clientInfo(req),
    });
    return this.me(auth.user.id);
  }

  @Delete('me/avatar')
  async remove(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest): Promise<PublicUser> {
    if (await this.avatars.remove(auth.user.id)) {
      await this.audit.record({
        action: 'user.avatar_removed',
        actorId: auth.user.id,
        entityType: 'user',
        entityId: auth.user.id,
        ...clientInfo(req),
      });
    }
    return this.me(auth.user.id);
  }

  @Get(':id/avatar')
  @HttpCode(200)
  async show(@Param('id', uuidParam) id: string, @Res() reply: FastifyReply): Promise<void> {
    const path = await this.avatars.pathFor(id);
    if (!path) throw new AppException(404, 'NOT_FOUND', 'Esta pessoa não tem foto.');
    // A URL muda a cada troca de foto (?v=…), então o navegador pode guardar por muito tempo.
    await reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(path));
  }

  private async me(id: string): Promise<PublicUser> {
    const loaded = await this.users.load(id);
    if (!loaded) throw new AppException(404, 'NOT_FOUND', 'Usuário não encontrado');
    return this.users.toPublic(loaded.user, loaded.orgUnit, loaded.mfaEnabled);
  }
}
