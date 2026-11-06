import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  type RosterApplyResult,
  rosterApplySchema,
  type RosterPlan,
  rosterPlanSchema,
  type RosterStatus,
} from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe.js';
import { RequirePermission } from '../rbac/index.js';
import { RosterService } from './roster.service.js';

/** Painel → Lotação: importar a lista de quem trabalha em cada setor. */
@Controller('admin/roster')
@RequirePermission('settings.manage')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get()
  status(): Promise<RosterStatus> {
    return this.roster.status();
  }

  /** Lê o arquivo e mostra o que mudaria. Não grava nada. */
  @Post('preview')
  @HttpCode(200)
  preview(
    @Body(new ZodPipe(rosterPlanSchema)) body: z.output<typeof rosterPlanSchema>,
    @Req() req: FastifyRequest,
  ): Promise<RosterPlan> {
    return this.roster.preview(body, req.auth!.user.id);
  }

  @Post('apply')
  @HttpCode(200)
  apply(
    @Body(new ZodPipe(rosterApplySchema)) body: z.output<typeof rosterApplySchema>,
    @Req() req: FastifyRequest,
  ): Promise<RosterApplyResult> {
    return this.roster.apply(body, req.auth!.user.id);
  }

  /** A lotação volta a vir das OUs do AD (a lista fica guardada, sem efeito). */
  @Post('deactivate')
  @HttpCode(200)
  deactivate(@Req() req: FastifyRequest): Promise<RosterStatus> {
    return this.roster.deactivate(req.auth!.user.id);
  }
}
