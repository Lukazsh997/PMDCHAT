import { Inject, Injectable } from '@nestjs/common';
import type { ChangePasswordRequest, LoginRequest, SessionDevice } from '@plataforma/contracts';
import { AppException } from '../../common/app-exception.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import type { UserRow } from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import { UsersService } from '../users/index.js';
import type { ActiveSession, AuthContext } from './auth.types.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
  deviceType: SessionDevice;
}

const MAX_LOCK_MINUTES = 240;

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(
    input: LoginRequest,
    meta: ClientMeta,
  ): Promise<{ token: string; user: UserRow; session: ActiveSession }> {
    const found = await this.users.findForLogin(input.username);

    if (!found?.credentials) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record({
        action: 'auth.login_failed',
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { username: input.username, reason: 'unknown_user' },
      });
      throw invalidCredentials();
    }

    const { user, credentials } = found;
    const now = new Date();

    if (credentials.lockedUntil && credentials.lockedUntil > now) {
      const minutes = Math.ceil((credentials.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw new AppException(
        423,
        'ACCOUNT_LOCKED',
        `Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em ${minutes} min.`,
      );
    }

    const valid = await this.passwords.verify(credentials.passwordHash, input.password);
    if (!valid) {
      await this.registerFailure(user, credentials.failedAttempts + 1, meta);
      throw invalidCredentials();
    }

    if (user.status !== 'active') {
      await this.audit.record({
        action: 'auth.login_failed',
        actorId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { reason: `status_${user.status}` },
      });
      throw new AppException(403, 'ACCOUNT_INACTIVE', 'Conta inativa. Procure o administrador.');
    }

    const rehash = this.passwords.needsRehash(credentials.passwordHash)
      ? await this.passwords.hash(input.password)
      : undefined;
    await this.users.recordSuccessfulLogin(user.id, rehash);

    const { token, session } = await this.sessions.create({
      userId: user.id,
      deviceType: meta.deviceType,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.record({
      action: 'auth.login_succeeded',
      actorId: user.id,
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { deviceType: meta.deviceType },
    });
    return { token, user, session };
  }

  async logout(auth: AuthContext, meta: Omit<ClientMeta, 'deviceType'>): Promise<void> {
    await this.sessions.revokeByHash(auth.user.id, auth.session.tokenHash, 'logout');
    await this.audit.record({
      action: 'auth.logout',
      actorId: auth.user.id,
      entityType: 'session',
      entityId: auth.session.id,
      ...meta,
    });
  }

  /** Troca a senha e encerra as demais sessões do usuário. */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordRequest,
    meta: Omit<ClientMeta, 'deviceType'>,
  ): Promise<void> {
    if (auth.user.authSource !== 'local') {
      throw new AppException(
        409,
        'CONFLICT',
        'A senha desta conta é gerenciada pelo Active Directory.',
      );
    }
    const credentials = await this.users.findCredentials(auth.user.id);
    const valid =
      credentials && (await this.passwords.verify(credentials.passwordHash, input.currentPassword));
    if (!valid) {
      throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', {
        currentPassword: ['Senha atual incorreta'],
      });
    }

    await this.users.setPassword(auth.user.id, await this.passwords.hash(input.newPassword), false);
    const revoked = await this.sessions.revokeAllForUser(
      auth.user.id,
      'password_changed',
      auth.session.tokenHash,
    );
    await this.audit.record({
      action: 'auth.password_changed',
      actorId: auth.user.id,
      entityType: 'user',
      entityId: auth.user.id,
      ...meta,
      metadata: { otherSessionsRevoked: revoked },
    });
  }

  /** Bloqueio progressivo: a cada N falhas seguidas, o tempo de bloqueio dobra. */
  private async registerFailure(user: UserRow, attempts: number, meta: ClientMeta): Promise<void> {
    const max = this.config.LOGIN_MAX_ATTEMPTS;
    let lockedUntil: Date | null = null;
    if (attempts % max === 0) {
      const round = attempts / max;
      const minutes = Math.min(this.config.LOGIN_LOCK_MINUTES * 2 ** (round - 1), MAX_LOCK_MINUTES);
      lockedUntil = new Date(Date.now() + minutes * 60_000);
    }
    await this.users.recordFailedAttempt(user.id, attempts, lockedUntil);
    await this.audit.record({
      action: lockedUntil ? 'auth.account_locked' : 'auth.login_failed',
      actorId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { reason: 'bad_password', attempts, lockedUntil: lockedUntil?.toISOString() },
    });
  }
}

function invalidCredentials(): AppException {
  return new AppException(401, 'INVALID_CREDENTIALS', 'Usuário ou senha incorretos.');
}
