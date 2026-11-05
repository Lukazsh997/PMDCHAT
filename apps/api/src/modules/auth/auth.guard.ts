import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppException } from '../../common/app-exception.js';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC } from '../../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { isUsable, UsersService } from '../users/index.js';
import { SessionService } from './session.service.js';
import type { AuthContext } from './auth.types.js';

/**
 * Guard global: toda rota exige sessão válida, exceto as marcadas com `@Public()`.
 * Nunca confiar no frontend — a verificação acontece aqui, em cada requisição.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = req.cookies[this.config.SESSION_COOKIE_NAME];
    req.auth = await authenticate(token, this.sessions, this.users);

    if (
      req.auth.user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)
    ) {
      throw new AppException(403, 'PASSWORD_CHANGE_REQUIRED', 'Troque sua senha para continuar.');
    }
    return true;
  }
}

/** Valida o token de sessão (cookie) — usado pelo HTTP e pelo tempo real. */
export async function authenticate(
  token: string | undefined,
  sessions: SessionService,
  users: UsersService,
): Promise<AuthContext> {
  const session = token ? await sessions.validate(token) : null;
  if (!session) {
    const message = token ? 'Sessão expirada. Entre novamente.' : 'Entre para continuar.';
    throw new AppException(401, 'UNAUTHENTICATED', message);
  }
  const loaded = await users.load(session.userId);
  if (!loaded || !isUsable(loaded.user)) {
    await sessions.revokeByHash(session.userId, session.tokenHash, 'user_inactive');
    throw new AppException(401, 'UNAUTHENTICATED', 'Sessão encerrada. Entre novamente.');
  }
  return { ...loaded, session };
}
