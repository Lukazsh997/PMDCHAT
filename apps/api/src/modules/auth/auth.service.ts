import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ChangePasswordRequest, LoginRequest, SessionDevice } from '@plataforma/contracts';
import { AppException } from '../../common/app-exception.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import type { UserRow } from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import { isUsable, UsersService } from '../users/index.js';
import type { ActiveSession, AuthContext } from './auth.types.js';
import {
  EXTERNAL_AUTH,
  type ExternalAuthenticator,
  ExternalAuthUnavailableError,
} from './external-auth.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
  deviceType: SessionDevice;
}

export type LoginResult =
  | { kind: 'session'; token: string; userId: string; session: ActiveSession }
  | { kind: 'mfa'; challengeId: string };

interface Challenge {
  userId: string;
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
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    /** Active Directory (Fase 3); ausente nos testes que não o usam. */
    @Optional() @Inject(EXTERNAL_AUTH) private readonly external?: ExternalAuthenticator,
  ) {}

  async login(input: LoginRequest, meta: ClientMeta): Promise<LoginResult> {
    let found = await this.users.findForLogin(input.username);

    // Conta do AD (ou pessoa que ainda não tem conta aqui): a senha é conferida no AD.
    if (found?.user.authSource === 'ldap' || (!found && this.external)) {
      if (found?.credentials) this.ensureNotLocked(found.credentials.lockedUntil);
      const result = await this.authenticateExternal(input.username, input.password);
      if (result === 'invalid' || result === 'not_provisioned' || result === null) {
        if (found?.credentials) {
          await this.registerFailure(found.user, found.credentials.failedAttempts + 1, meta);
        } else {
          await this.audit.record({
            action: 'auth.login_failed',
            ip: meta.ip,
            userAgent: meta.userAgent,
            metadata: {
              username: input.username,
              reason: result === 'not_provisioned' ? 'ldap_not_provisioned' : 'unknown_user',
            },
          });
        }
        if (result === null && found) {
          throw new AppException(
            403,
            'ACCOUNT_INACTIVE',
            'O login pelo Active Directory está desligado. Procure o administrador.',
          );
        }
        if (result === 'not_provisioned') {
          throw new AppException(
            403,
            'ACCOUNT_INACTIVE',
            'Sua conta do Active Directory ainda não foi liberada neste sistema. Procure o administrador.',
          );
        }
        throw invalidCredentials();
      }
      // Recarrega: o login no AD pode ter criado a conta ou mudado nome, lotação e situação.
      found = await this.users.findForLogin(input.username);
      if (!found?.credentials) throw invalidCredentials();
      await this.ensureUsable(found.user, meta);
      return this.afterPassword(found.user, found.credentials, meta);
    }

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
    this.ensureNotLocked(credentials.lockedUntil);

    const valid = await this.passwords.verify(credentials.passwordHash, input.password);
    if (!valid) {
      await this.registerFailure(user, credentials.failedAttempts + 1, meta);
      throw invalidCredentials();
    }
    await this.ensureUsable(user, meta);

    const rehash = this.passwords.needsRehash(credentials.passwordHash)
      ? await this.passwords.hash(input.password)
      : undefined;
    return this.afterPassword(user, credentials, meta, rehash);
  }

  /** Senha conferida (local ou no AD): pede o código do MFA, se ativo, ou abre a sessão. */
  private async afterPassword(
    user: UserRow,
    credentials: { mfaEnabledAt: Date | null; mfaSecretEnc: string | null },
    meta: ClientMeta,
    rehash?: string,
  ): Promise<LoginResult> {
    if (credentials.mfaEnabledAt && credentials.mfaSecretEnc) {
      if (rehash) await this.users.setPassword(user.id, rehash, user.mustChangePassword);
      const challengeId = await this.mfa.createChallenge({
        userId: user.id,
        deviceType: meta.deviceType,
      } satisfies Challenge);
      return { kind: 'mfa', challengeId };
    }

    await this.users.recordSuccessfulLogin(user.id, rehash);
    return this.openSession(user.id, meta);
  }

  private async authenticateExternal(username: string, password: string) {
    if (!this.external) return null;
    try {
      return await this.external.authenticate(username, password);
    } catch (e) {
      if (e instanceof ExternalAuthUnavailableError) {
        throw new AppException(
          503,
          'DIRECTORY_UNAVAILABLE',
          'Não foi possível falar com o Active Directory agora. Tente de novo em instantes ou procure o suporte.',
        );
      }
      throw e;
    }
  }

  /** Segunda etapa do login: código do aplicativo autenticador. */
  async loginMfa(challengeId: string, code: string, meta: ClientMeta): Promise<LoginResult> {
    const challenge = await this.mfa.readChallenge<Challenge>(challengeId);
    if (!challenge) {
      throw new AppException(401, 'UNAUTHENTICATED', 'O código expirou. Entre novamente.');
    }
    const found = await this.users.load(challenge.userId);
    const credentials = found && (await this.users.findCredentials(found.user.id));
    if (!found || !credentials?.mfaSecretEnc) {
      await this.mfa.consumeChallenge(challengeId);
      throw new AppException(401, 'UNAUTHENTICATED', 'Entre novamente.');
    }
    this.ensureNotLocked(credentials.lockedUntil);
    await this.ensureUsable(found.user, meta);

    if (!this.mfa.verify(credentials.mfaSecretEnc, found.user.username, code)) {
      const canRetry = await this.mfa.failChallenge(challengeId);
      await this.audit.record({
        action: 'auth.mfa_failed',
        actorId: found.user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      if (!canRetry) {
        throw new AppException(
          401,
          'UNAUTHENTICATED',
          'Muitos códigos incorretos. Entre novamente.',
        );
      }
      throw new AppException(
        400,
        'MFA_INVALID',
        'Código incorreto. Confira o aplicativo e tente de novo.',
      );
    }

    await this.mfa.consumeChallenge(challengeId);
    await this.users.recordSuccessfulLogin(found.user.id);
    return this.openSession(found.user.id, { ...meta, deviceType: challenge.deviceType });
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
    await this.requirePassword(
      auth.user.id,
      input.currentPassword,
      'currentPassword',
      'Senha atual incorreta',
    );

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

  startMfaSetup(auth: AuthContext) {
    if (auth.mfaEnabled) {
      throw new AppException(409, 'CONFLICT', 'A verificação em duas etapas já está ativa.');
    }
    return this.mfa.startSetup(auth.user.id, auth.user.username);
  }

  async enableMfa(auth: AuthContext, code: string, meta: Omit<ClientMeta, 'deviceType'>) {
    const sealed = await this.mfa.finishSetup(auth.user.id, auth.user.username, code);
    if (!sealed) {
      throw new AppException(
        400,
        'MFA_INVALID',
        'Código incorreto ou expirado. Gere um novo QR code se necessário.',
      );
    }
    await this.users.setMfa(auth.user.id, sealed);
    await this.audit.record({
      action: 'auth.mfa_enabled',
      actorId: auth.user.id,
      entityType: 'user',
      entityId: auth.user.id,
      ...meta,
    });
  }

  async disableMfa(auth: AuthContext, password: string, meta: Omit<ClientMeta, 'deviceType'>) {
    await this.requirePassword(auth.user.id, password, 'password', 'Senha incorreta');
    await this.users.setMfa(auth.user.id, null);
    await this.audit.record({
      action: 'auth.mfa_disabled',
      actorId: auth.user.id,
      entityType: 'user',
      entityId: auth.user.id,
      ...meta,
    });
  }

  private async requirePassword(userId: string, password: string, field: string, message: string) {
    const loaded = await this.users.load(userId);
    let valid: boolean;
    if (loaded?.user.authSource === 'ldap') {
      // Conta do AD: a senha que vale é a do AD.
      const r = await this.authenticateExternal(loaded.user.username, password);
      valid = typeof r === 'object' && r !== null && r.userId === userId;
    } else {
      const credentials = await this.users.findCredentials(userId);
      valid = !!credentials && (await this.passwords.verify(credentials.passwordHash, password));
    }
    if (!valid)
      throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', { [field]: [message] });
  }

  private async openSession(userId: string, meta: ClientMeta): Promise<LoginResult> {
    const { token, session } = await this.sessions.create({
      userId,
      deviceType: meta.deviceType,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.record({
      action: 'auth.login_succeeded',
      actorId: userId,
      entityType: 'session',
      entityId: session.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { deviceType: meta.deviceType },
    });
    return { kind: 'session', token, userId, session };
  }

  private ensureNotLocked(lockedUntil: Date | null): void {
    const now = new Date();
    if (lockedUntil && lockedUntil > now) {
      const minutes = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000);
      throw new AppException(
        423,
        'ACCOUNT_LOCKED',
        `Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em ${minutes} min.`,
      );
    }
  }

  private async ensureUsable(user: UserRow, meta: ClientMeta): Promise<void> {
    if (isUsable(user)) return;
    const expired = user.status === 'active' && user.accessExpiresAt !== null;
    await this.audit.record({
      action: 'auth.login_failed',
      actorId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { reason: expired ? 'guest_expired' : `status_${user.status}` },
    });
    throw new AppException(
      403,
      'ACCOUNT_INACTIVE',
      expired
        ? 'O prazo de acesso desta conta de convidado terminou.'
        : 'Conta inativa. Procure o administrador.',
    );
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
