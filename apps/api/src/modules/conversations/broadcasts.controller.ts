import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import {
  type BroadcastPreview,
  type BroadcastResult,
  type BroadcastScopes,
  sendBroadcastSchema,
} from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientInfo, CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthContext } from '../auth/index.js';
import { PermissionService, RequirePermission, requestGrants } from '../rbac/index.js';
import { BroadcastsService } from './broadcasts.service.js';

const previewQuery = z.object({
  orgUnitId: z.uuid(),
  includeSubunits: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

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

  @Get('preview')
  @RequirePermission('broadcast.send')
  async preview(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(previewQuery)) q: z.infer<typeof previewQuery>,
    @Req() req: FastifyRequest,
  ): Promise<BroadcastPreview> {
    const grants = await requestGrants(req, this.permissions);
    return {
      recipientCount: await this.broadcasts.preview(auth, grants, q.orgUnitId, q.includeSubunits),
    };
  }

  @Post()
  @RequirePermission('broadcast.send')
  async send(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(sendBroadcastSchema)) body: z.output<typeof sendBroadcastSchema>,
    @Req() req: FastifyRequest,
  ): Promise<BroadcastResult> {
    const grants = await requestGrants(req, this.permissions);
    return this.broadcasts.send(auth, grants, body, clientInfo(req));
  }
}
