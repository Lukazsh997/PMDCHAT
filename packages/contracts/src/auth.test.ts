import { describe, expect, it } from 'vitest';
import { changePasswordRequestSchema, loginRequestSchema, passwordSchema } from './auth.js';

describe('contratos de autenticação', () => {
  it('normaliza o usuário para minúsculas e sem espaços', () => {
    const r = loginRequestSchema.parse({ username: '  Maria.Silva ', password: 'x' });
    expect(r.username).toBe('maria.silva');
  });

  it('aceita o login no formato do Windows (DOMINIO\\usuario e usuario@dominio)', () => {
    for (const u of ['ORGAO\\Joao.Silva', 'joao.silva@orgao.local', ' Joao.Silva ']) {
      expect(loginRequestSchema.parse({ username: u, password: 'x' }).username).toBe('joao.silva');
    }
  });

  it('rejeita caracteres inválidos no usuário', () => {
    expect(loginRequestSchema.safeParse({ username: 'maria silva', password: 'x' }).success).toBe(
      false,
    );
  });

  it('exige letras e números na senha nova', () => {
    expect(passwordSchema.safeParse('somenteletras').success).toBe(false);
    expect(passwordSchema.safeParse('1234567890').success).toBe(false);
    expect(passwordSchema.safeParse('senhaForte2026').success).toBe(true);
  });

  it('impede reutilizar a senha atual', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'senhaForte2026',
      newPassword: 'senhaForte2026',
    });
    expect(r.success).toBe(false);
  });
});
