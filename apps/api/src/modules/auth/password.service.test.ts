import { hash } from '@node-rs/argon2';
import { beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();
  beforeAll(() => service.onModuleInit());

  it('gera hash Argon2id e verifica a senha', async () => {
    const h = await service.hash('senhaSegura2026');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await service.verify(h, 'senhaSegura2026')).toBe(true);
    expect(await service.verify(h, 'outra')).toBe(false);
  });

  it('não lança erro com hash corrompido', async () => {
    expect(await service.verify('lixo', 'x')).toBe(false);
  });

  it('pede rehash quando os parâmetros mudam', async () => {
    expect(service.needsRehash(await service.hash('a1b2c3d4e5'))).toBe(false);
    expect(service.needsRehash(await hash('a1b2c3d4e5', { memoryCost: 4096, timeCost: 1 }))).toBe(
      true,
    );
  });
});
