import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '../modules/auth/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const IS_PUBLIC = 'isPublic';
/** Rota acessível sem sessão (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
/** Rota liberada mesmo quando o usuário precisa trocar a senha. */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const ALLOW_PENDING_ORG_UNIT = 'allowPendingOrgUnit';

/** Rota acessível enquanto a pessoa ainda não escolheu o setor no 1º acesso. */
export const AllowPendingOrgUnit = () => SetMetadata(ALLOW_PENDING_ORG_UNIT, true);

/** Injeta o contexto de autenticação da requisição atual. */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  return req.auth;
});

export function clientInfo(req: FastifyRequest): { ip: string | null; userAgent: string | null } {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: ua ? ua.slice(0, 512) : null };
}
