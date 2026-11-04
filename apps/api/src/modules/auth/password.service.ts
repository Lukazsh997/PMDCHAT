import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Algorithm, hash, type Options, parseOptions, verify } from '@node-rs/argon2';

/**
 * Parâmetros Argon2id recomendados pela OWASP (19 MiB, 2 iterações, 1 thread):
 * custo baixo para o servidor e alto para quem tentar quebrar os hashes.
 */
const ARGON2_OPTIONS: Options = {
  algorithm: 2 as Algorithm, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService implements OnModuleInit {
  /** Hash descartável usado para igualar o tempo de resposta quando o usuário não existe. */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('senha-inexistente-para-tempo-constante', ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Gasta o mesmo tempo de uma verificação real, sem revelar se o usuário existe. */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }

  /** Indica se o hash foi gerado com parâmetros antigos e deve ser refeito. */
  needsRehash(passwordHash: string): boolean {
    try {
      const p = parseOptions(passwordHash);
      return (
        p.algorithm !== ARGON2_OPTIONS.algorithm ||
        p.memoryCost !== ARGON2_OPTIONS.memoryCost ||
        p.timeCost !== ARGON2_OPTIONS.timeCost ||
        p.parallelism !== ARGON2_OPTIONS.parallelism
      );
    } catch {
      return true;
    }
  }
}
