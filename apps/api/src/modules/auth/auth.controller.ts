import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ChangePasswordRequest,
  changePasswordRequestSchema,
  disableMfaSchema,
  enableMfaSchema,
  type LoginMfaChallenge,
  type LoginMfaRequest,
  loginMfaSchema,
  type LoginRequest,
  loginRequestSchema,
  type MeResponse,
  type MfaSetupResponse,
  type SessionInfo,
} from '@plataforma/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import {
  AllowPendingPasswordChange,
  clientInfo,
  CurrentAuth,
  Public,
} from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { PermissionService, requestGrants } from '../rbac/index.js';
import { UsersService } from '../users/index.js';
import { authenticate } from './auth.guard.js';
import { AuthService, type LoginResult } from './auth.service.js';
import type { AuthContext } from './auth.types.js';
import { SessionService } from './session.service.js';

const uuidParam = new ZodPipe(z.uuid());

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    private readonly permissions: PermissionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse | LoginMfaChallenge> {
    const deviceType = req.headers['x-client'] === 'desktop' ? 'desktop' : 'web';
    const result = await this.auth.login(body, { ...clientInfo(req), deviceType });
    return this.finish(result, req, reply);
  }

  @Public()
  @Post('login/mfa')
  @HttpCode(200)
  async loginMfa(
    @Body(new ZodPipe(loginMfaSchema)) body: LoginMfaRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse | LoginMfaChallenge> {
    const deviceType = req.headers['x-client'] === 'desktop' ? 'desktop' : 'web';
    const result = await this.auth.loginMfa(body.challengeId, body.code, {
      ...clientInfo(req),
      deviceType,
    });
    return this.finish(result, req, reply);
  }

  @AllowPendingPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(auth, clientInfo(req));
    void reply.clearCookie(this.config.SESSION_COOKIE_NAME, { path: '/' });
  }

  @AllowPendingPasswordChange()
  @Get('me')
  getMe(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest): Promise<MeResponse> {
    return this.me(auth, req);
  }

  @AllowPendingPasswordChange()
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.auth.changePassword(auth, body, clientInfo(req));
  }

  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentAuth() auth: AuthContext): Promise<MfaSetupResponse> {
    return this.auth.startMfaSetup(auth);
  }

  @Post('mfa/enable')
  @HttpCode(204)
  async mfaEnable(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(enableMfaSchema)) body: { code: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.auth.enableMfa(auth, body.code, clientInfo(req));
  }

  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(disableMfaSchema)) body: { password: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const grants = await requestGrants(req, this.permissions);
    if (grants.requiresMfa && this.config.MFA_REQUIRED_FOR_ADMINS) {
      throw new AppException(
        409,
        'CONFLICT',
        'Administradores precisam manter a verificação em duas etapas.',
      );
    }
    await this.auth.disableMfa(auth, body.password, clientInfo(req));
  }

  @Get('sessions')
  listSessions(@CurrentAuth() auth: AuthContext): Promise<SessionInfo[]> {
    return this.sessions.list(auth.user.id, auth.session.tokenHash);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    if (id === auth.session.id) {
      throw new AppException(409, 'CONFLICT', 'Para encerrar a sessão atual, use "Sair".');
    }
    const ok = await this.sessions.revokeById(auth.user.id, id, 'revoked_by_user');
    if (!ok) throw new AppException(404, 'NOT_FOUND', 'Sessão não encontrada');
  }

  private async finish(
    result: LoginResult,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MeResponse | LoginMfaChallenge> {
    if (result.kind === 'mfa') return { mfaRequired: true, challengeId: result.challengeId };
    void reply.setCookie(this.config.SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
    });
    const auth = await authenticate(result.token, this.sessions, this.users);
    return this.me(auth, req);
  }

  private async me(auth: AuthContext, req: FastifyRequest): Promise<MeResponse> {
    req.auth = auth;
    const grants = await requestGrants(req, this.permissions);
    return {
      user: this.users.toPublic(auth.user, auth.orgUnit, auth.mfaEnabled),
      session: { id: auth.session.id, expiresAt: auth.session.expiresAt },
      permissions: grants.permissions,
      mfaSetupRequired:
        this.config.MFA_REQUIRED_FOR_ADMINS && grants.requiresMfa && !auth.mfaEnabled,
    };
  }
}
