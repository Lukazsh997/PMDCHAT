import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
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

  /**
   * Senha temporária legível para ditar ao usuário: 3 grupos de 4 caracteres, sem
   * letras e números que se confundem (0/O, 1/l/I). Sempre tem letras e números.
   */
  generateTemporary(): string {
    const letters = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const all = letters + digits;
    const pick = (set: string) => set[randomInt(set.length)]!;
    const groups = Array.from({ length: 3 }, () =>
      Array.from({ length: 4 }, () => pick(all)).join(''),
    );
    groups[0] = pick(letters) + groups[0]!.slice(1);
    groups[2] = groups[2]!.slice(0, 3) + pick(digits);
    return groups.join('-');
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
