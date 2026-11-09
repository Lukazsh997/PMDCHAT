import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { AppException } from '../../common/app-exception.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { type Grants, PermissionService } from './permission.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    grants?: Grants;
  }
}

const REQUIRED = 'requiredPermission';

/**
 * Exige a permissão em algum escopo. Checagens de escopo (ex.: "este usuário está
 * na minha unidade?") ficam no serviço, que conhece o recurso.
 */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.auth) return false;
    const grants = await this.loadGrants(req);

    if (!grants.hasAny(required)) {
      throw new AppException(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.');
    }
    if (this.config.MFA_REQUIRED_FOR_ADMINS && grants.requiresMfa && !req.auth.mfaEnabled) {
      throw new AppException(
        403,
        'MFA_REQUIRED',
        'Ative a verificação em duas etapas em "Minha conta" para usar o painel administrativo.',
      );
    }
    return true;
  }

  private async loadGrants(req: FastifyRequest): Promise<Grants> {
    req.grants ??= await this.permissions.grantsFor(req.auth!.user.id);
    return req.grants;
  }
}

/** Grants da requisição atual (carregados pelo guard ou sob demanda). */
export async function requestGrants(
  req: FastifyRequest,
  permissions: PermissionService,
): Promise<Grants> {
  req.grants ??= await permissions.grantsFor(req.auth!.user.id);
  return req.grants;
}
