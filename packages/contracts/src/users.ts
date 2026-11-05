import { z } from 'zod';
import { usernameSchema } from './auth.js';
import type { Permission, RoleKey } from './rbac.js';

export const userStatusSchema = z.enum(['active', 'blocked', 'disabled']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const authSourceSchema = z.enum(['local', 'ldap']);
export type AuthSource = z.infer<typeof authSourceSchema>;

/** `guest`: convidado/externo, participa só das conversas em que foi incluído. */
export const userKindSchema = z.enum(['member', 'guest']);
export type UserKind = z.infer<typeof userKindSchema>;

export interface OrgUnitRef {
  id: string;
  name: string;
  acronym: string | null;
}

/** Representação pública de um usuário, segura para enviar ao cliente. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  status: UserStatus;
  kind: UserKind;
  authSource: AuthSource;
  orgUnit: OrgUnitRef | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  /** Endereço da foto de perfil (muda quando a foto é trocada), ou null. */
  avatarUrl: string | null;
}

export interface MeResponse {
  user: PublicUser;
  session: { id: string; expiresAt: string };
  /** Permissões que o usuário tem em algum escopo (para exibir menus). */
  permissions: Permission[];
  /** Quem acessa o painel precisa ativar a verificação em duas etapas. */
  mfaSetupRequired: boolean;
}

/** Pessoa no diretório (busca para iniciar conversas). */
export interface DirectoryUser {
  id: string;
  displayName: string;
  username: string;
  jobTitle: string | null;
  kind: UserKind;
  orgUnit: OrgUnitRef | null;
  avatarUrl: string | null;
  /** Conta excluída: aparece só no histórico das conversas. */
  removed?: true;
}

/* ---------------------------- Administração ---------------------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const createUserSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(3, 'Informe o nome completo').max(160),
  email: z
    .union([z.email('E-mail inválido'), z.literal('')])
    .transform((v) => v || null)
    .nullable()
    .optional(),
  jobTitle: optionalText(160),
  orgUnitId: z.uuid().nullable(),
  kind: userKindSchema.default('member'),
  /** Data em que o acesso de um convidado expira (ISO). */
  accessExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type CreateUserRequest = z.input<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.omit({ username: true }).partial();
export type UpdateUserRequest = z.input<typeof updateUserSchema>;

export const setUserStatusSchema = z.object({ status: userStatusSchema });

export interface RoleAssignment {
  id: string;
  role: RoleKey;
  roleName: string;
  orgUnit: OrgUnitRef | null;
  createdAt: string;
}

export interface AdminUser extends PublicUser {
  lastLoginAt: string | null;
  createdAt: string;
  accessExpiresAt: string | null;
  lockedUntil: string | null;
  roles: RoleAssignment[];
}

export interface AdminUserList {
  items: AdminUser[];
  total: number;
}

export interface CreateUserResponse {
  user: AdminUser;
  temporaryPassword: string;
}

export const assignRoleSchema = z.object({
  role: z.string().trim().min(1).max(32),
  orgUnitId: z.uuid().nullable().optional(),
});
export type AssignRoleRequest = z.infer<typeof assignRoleSchema>;

/** Exclusão de usuário: o super administrador redigita o login para confirmar. */
export const deleteUserSchema = z.object({ confirmUsername: z.string().trim().min(1) });
export type DeleteUserRequest = z.infer<typeof deleteUserSchema>;

/* ------------------------------ Auditoria ------------------------------ */

export interface AuditEntry {
  id: string;
  action: string;
  actor: { id: string; displayName: string; username: string } | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
}

export interface AdminStats {
  activeUsers: number;
  guests: number;
  blockedUsers: number;
  orgUnits: number;
  conversations: number;
  messagesLast24h: number;
  onlineNow: number;
}
