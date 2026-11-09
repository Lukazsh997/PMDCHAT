import { z } from 'zod';

/**
 * Política de senha padrão. Os limites são repetidos na API (fonte da verdade)
 * e na interface (para feedback imediato ao usuário).
 */
export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
} as const;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'O usuário deve ter ao menos 3 caracteres')
  .max(64, 'O usuário deve ter no máximo 64 caracteres')
  .regex(/^[a-z0-9._-]+$/, 'Use apenas letras minúsculas, números, ponto, hífen ou sublinhado');

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_POLICY.minLength,
    `A senha deve ter ao menos ${PASSWORD_POLICY.minLength} caracteres`,
  )
  .max(
    PASSWORD_POLICY.maxLength,
    `A senha deve ter no máximo ${PASSWORD_POLICY.maxLength} caracteres`,
  )
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'A senha deve conter letras e números');

/**
 * Aceita o login como o Windows mostra: "ORGAO\\joao" e "joao@orgao.local" viram "joao".
 */
export const loginUsernameSchema = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  const afterSlash = t.includes('\\') ? t.slice(t.lastIndexOf('\\') + 1) : t;
  return afterSlash.includes('@') ? afterSlash.slice(0, afterSlash.indexOf('@')) : afterSlash;
}, usernameSchema);

export const loginRequestSchema = z.object({
  username: loginUsernameSchema,
  // No login não aplicamos a política completa: senhas antigas continuam válidas.
  password: z.string().min(1, 'Informe a senha').max(PASSWORD_POLICY.maxLength),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'A nova senha deve ser diferente da atual',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const mfaCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Digite os 6 números do aplicativo autenticador');

export const loginMfaSchema = z.object({
  challengeId: z.string().min(16).max(128),
  code: mfaCodeSchema,
});
export type LoginMfaRequest = z.infer<typeof loginMfaSchema>;

/** Resposta do login quando a verificação em duas etapas está ativa. */
export interface LoginMfaChallenge {
  mfaRequired: true;
  challengeId: string;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export const enableMfaSchema = z.object({ code: mfaCodeSchema });
export const disableMfaSchema = z.object({ password: z.string().min(1, 'Informe a senha') });

export const sessionDeviceSchema = z.enum(['web', 'desktop']);
export type SessionDevice = z.infer<typeof sessionDeviceSchema>;

export interface SessionInfo {
  id: string;
  deviceType: SessionDevice;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
