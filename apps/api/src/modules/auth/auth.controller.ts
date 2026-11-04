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
  type LoginRequest,
  loginRequestSchema,
  type MeResponse,
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
import { UsersService } from '../users/index.js';
import { AuthService } from './auth.service.js';
import type { ActiveSession, AuthContext } from './auth.types.js';
import { SessionService } from './session.service.js';

const uuidParam = new ZodPipe(z.uuid());

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    const deviceType = req.headers['x-client'] === 'desktop' ? 'desktop' : 'web';
    const { token, user, session } = await this.auth.login(body, {
      ...clientInfo(req),
      deviceType,
    });
    void reply.setCookie(this.config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
      // Cookie de sessão do navegador; o servidor controla a expiração real.
    });
    return this.me(user, session);
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
  getMe(@CurrentAuth() auth: AuthContext): MeResponse {
    return this.me(auth.user, auth.session);
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

  private me(user: AuthContext['user'], session: ActiveSession): MeResponse {
    return {
      user: this.users.toPublic(user),
      session: { id: session.id, expiresAt: session.expiresAt },
    };
  }
}
