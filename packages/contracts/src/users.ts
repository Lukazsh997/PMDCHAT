import { z } from 'zod';

export const userStatusSchema = z.enum(['active', 'blocked', 'disabled']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const authSourceSchema = z.enum(['local', 'ldap']);
export type AuthSource = z.infer<typeof authSourceSchema>;

/** Representação pública de um usuário, segura para enviar ao cliente. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  status: UserStatus;
  authSource: AuthSource;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: PublicUser;
  session: { id: string; expiresAt: string };
}
