import { Inject, Injectable } from '@nestjs/common';
import type { MfaSetupResponse } from '@plataforma/contracts';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { SecretBox } from '../../common/crypto.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { REDIS } from '../../redis/redis.module.js';

const ISSUER = 'Comunicação Interna';
const SETUP_TTL_SECONDS = 10 * 60;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * Verificação em duas etapas por TOTP (Google Authenticator, Microsoft Authenticator,
 * FreeOTP, Aegis…). O segredo fica cifrado no banco com APP_SECRET.
 */
@Injectable()
export class MfaService {
  private readonly box: SecretBox;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.box = new SecretBox(config.APP_SECRET!);
  }

  /** Gera um segredo novo, guardado temporariamente até o usuário confirmar um código. */
  async startSetup(userId: string, username: string): Promise<MfaSetupResponse> {
    const secret = new Secret({ size: 20 });
    await this.redis.set(`mfa:setup:${userId}`, secret.base32, 'EX', SETUP_TTL_SECONDS);
    const otpauthUrl = this.totp(secret.base32, username).toString();
    return {
      secret: secret.base32,
      otpauthUrl,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }),
    };
  }

  /** Confirma o código do aplicativo e devolve o segredo cifrado para gravar. */
  async finishSetup(userId: string, username: string, code: string): Promise<string | null> {
    const base32 = await this.redis.get(`mfa:setup:${userId}`);
    if (!base32 || !this.check(base32, username, code)) return null;
    await this.redis.del(`mfa:setup:${userId}`);
    return this.box.seal(base32);
  }

  verify(secretEnc: string, username: string, code: string): boolean {
    try {
      return this.check(this.box.open(secretEnc), username, code);
    } catch {
      return false;
    }
  }

  /** Senha correta e MFA ativo: guarda um desafio de curta duração. */
  async createChallenge(payload: object): Promise<string> {
    const id = randomBytes(24).toString('base64url');
    await this.redis.set(
      `mfa:challenge:${id}`,
      JSON.stringify({ ...payload, attempts: 0 }),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return id;
  }

  async readChallenge<T>(id: string): Promise<(T & { attempts: number }) | null> {
    const raw = await this.redis.get(`mfa:challenge:${id}`);
    return raw ? (JSON.parse(raw) as T & { attempts: number }) : null;
  }

  /** Conta uma tentativa errada; após 5, o desafio é descartado e é preciso entrar de novo. */
  async failChallenge(id: string): Promise<boolean> {
    const c = await this.readChallenge<object>(id);
    if (!c) return false;
    if (c.attempts + 1 >= MAX_CHALLENGE_ATTEMPTS) {
      await this.redis.del(`mfa:challenge:${id}`);
      return false;
    }
    const ttl = await this.redis.ttl(`mfa:challenge:${id}`);
    await this.redis.set(
      `mfa:challenge:${id}`,
      JSON.stringify({ ...c, attempts: c.attempts + 1 }),
      'EX',
      Math.max(ttl, 1),
    );
    return true;
  }

  async consumeChallenge(id: string): Promise<void> {
    await this.redis.del(`mfa:challenge:${id}`);
  }

  private check(base32: string, username: string, code: string): boolean {
    // window 1: aceita o código anterior e o seguinte (relógios até 30 s fora).
    return this.totp(base32, username).validate({ token: code, window: 1 }) !== null;
  }

  private totp(base32: string, username: string): TOTP {
    return new TOTP({
      issuer: ISSUER,
      label: username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(base32),
    });
  }
}
