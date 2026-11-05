import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  type BroadcastPreview,
  type BroadcastResult,
  type BroadcastScopes,
  broadcastPreviewSchema,
  sendBroadcastSchema,
} from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientInfo, CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthContext } from '../auth/index.js';
import { PermissionService, requestGrants } from '../rbac/index.js';
import { BroadcastsService } from './broadcasts.service.js';

@Controller('broadcasts')
export class BroadcastsController {
  constructor(
    private readonly broadcasts: BroadcastsService,
    private readonly permissions: PermissionService,
  ) {}

  /** Onde a pessoa pode enviar comunicados (vazio para a maioria). */
  @Get('scopes')
  async scopes(@Req() req: FastifyRequest): Promise<BroadcastScopes> {
    return this.broadcasts.scopes(await requestGrants(req, this.permissions));
  }

  /** Quantas pessoas receberiam (sem repetir quem está em mais de um setor escolhido). */
  @Post('preview')
  @HttpCode(200)
  async preview(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(broadcastPreviewSchema)) body: z.output<typeof broadcastPreviewSchema>,
    @Req() req: FastifyRequest,
  ): Promise<BroadcastPreview> {
    const grants = await requestGrants(req, this.permissions);
    return this.broadcasts.preview(auth, grants, body);
  }

  /** Qualquer pessoa envia; sem a permissão de comunicado, até 50 destinatários (ver o serviço). */
  @Post()
  async send(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(sendBroadcastSchema)) body: z.output<typeof sendBroadcastSchema>,
    @Req() req: FastifyRequest,
  ): Promise<BroadcastResult> {
    const grants = await requestGrants(req, this.permissions);
    return this.broadcasts.send(auth, grants, body, clientInfo(req));
  }
}
