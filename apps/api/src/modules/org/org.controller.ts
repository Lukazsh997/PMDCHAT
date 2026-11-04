import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  type CreateOrgUnitRequest,
  createOrgUnitSchema,
  type OrgUnit,
  type UpdateOrgUnitRequest,
  updateOrgUnitSchema,
} from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientInfo, CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AuditService } from '../audit/index.js';
import type { AuthContext } from '../auth/index.js';
import { RequirePermission } from '../rbac/index.js';
import { OrgService } from './org.service.js';

const uuidParam = new ZodPipe(z.uuid());

@Controller('org-units')
export class OrgController {
  constructor(
    private readonly org: OrgService,
    private readonly audit: AuditService,
  ) {}

  /** Organograma completo: visível a todos os usuários (diretório). */
  @Get()
  list(): Promise<OrgUnit[]> {
    return this.org.list();
  }

  @Post()
  @RequirePermission('org.manage')
  async create(
    @Body(new ZodPipe(createOrgUnitSchema)) body: CreateOrgUnitRequest,
    @CurrentAuth() auth: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<OrgUnit> {
    const unit = await this.org.create(body);
    await this.audit.record({
      action: 'org_unit.created',
      actorId: auth.user.id,
      entityType: 'org_unit',
      entityId: unit.id,
      ...clientInfo(req),
      metadata: { name: unit.name, parentId: unit.parentId },
    });
    return this.org.toDto(unit);
  }

  @Patch(':id')
  @RequirePermission('org.manage')
  async update(
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateOrgUnitSchema)) body: UpdateOrgUnitRequest,
    @CurrentAuth() auth: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<OrgUnit> {
    const unit = await this.org.update(id, body);
    await this.audit.record({
      action: 'org_unit.updated',
      actorId: auth.user.id,
      entityType: 'org_unit',
      entityId: id,
      ...clientInfo(req),
      metadata: { changes: body },
    });
    return this.org.toDto(unit);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('org.manage')
  async remove(
    @Param('id', uuidParam) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const unit = await this.org.remove(id);
    await this.audit.record({
      action: 'org_unit.deleted',
      actorId: auth.user.id,
      entityType: 'org_unit',
      entityId: id,
      ...clientInfo(req),
      metadata: { name: unit.name },
    });
  }
}
