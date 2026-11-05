import { Controller, Get, Param, Req } from '@nestjs/common';
import { type Permission, PERMISSIONS, type PermissionScopes } from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe.js';
import { requestGrants } from './permission.guard.js';
import { PermissionService } from './permission.service.js';

/** Onde a pessoa logada tem uma permissão (a tela oferece só as unidades possíveis). */
@Controller('permissions')
export class ScopesController {
  constructor(private readonly permissions: PermissionService) {}

  @Get(':key/scopes')
  async scopes(
    @Param('key', new ZodPipe(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]])))
    key: Permission,
    @Req() req: FastifyRequest,
  ): Promise<PermissionScopes> {
    const paths = (await requestGrants(req, this.permissions)).scopePaths(key);
    if (paths === null) return { global: true, unitIds: [] };
    return { global: false, unitIds: paths.map((p) => p.split('/').at(-2)!) };
  }
}
