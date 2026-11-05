import { z } from 'zod';

/**
 * Catálogo de permissões (fixo, definido no código) e papéis.
 *
 * Os papéis ficam no banco e são editados no painel (Fase 2). Os de `ROLES` abaixo
 * são os papéis de sistema criados na instalação: podem ter as permissões ajustadas,
 * mas não podem ser excluídos. O super administrador tem sempre todas as permissões.
 * Cada atribuição liga um usuário a um papel com escopo global ou numa unidade
 * (incluindo as unidades abaixo dela).
 */
export const PERMISSIONS = {
  'admin.access': 'Acessar o painel administrativo',
  'users.read': 'Consultar usuários no painel',
  'users.manage': 'Criar, editar, bloquear usuários e gerar senha temporária',
  'org.manage': 'Gerenciar secretarias, subsecretarias e setores',
  'roles.assign': 'Atribuir e remover papéis',
  'audit.read': 'Consultar o registro de auditoria',
  'broadcast.send': 'Enviar comunicados em massa para unidades',
  'messages.mention_all': 'Usar @todos em grupos grandes',
  'conversations.create_channel': 'Criar canais de aviso',
  'users.delete': 'Excluir usuários definitivamente do diretório',
  'roles.manage': 'Criar e editar papéis',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES = {
  super_admin: {
    name: 'Super administrador',
    description: 'Acesso total ao sistema',
    permissions: Object.keys(PERMISSIONS) as Permission[],
    scoped: false,
  },
  unit_admin: {
    name: 'Administrador de unidade',
    description: 'Gerencia os usuários da unidade e das unidades abaixo dela',
    permissions: [
      'admin.access',
      'users.read',
      'users.manage',
      'broadcast.send',
      'conversations.create_channel',
    ] as Permission[],
    scoped: true,
  },
  auditor: {
    name: 'Auditor',
    description: 'Consulta usuários e o registro de auditoria, sem alterar nada',
    permissions: ['admin.access', 'users.read', 'audit.read'] as Permission[],
    scoped: false,
  },
  broadcaster: {
    name: 'Comunicador',
    description:
      'Envia comunicados e cria canais de aviso para a unidade e as unidades abaixo dela',
    permissions: [
      'broadcast.send',
      'messages.mention_all',
      'conversations.create_channel',
    ] as Permission[],
    scoped: true,
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: Permission[]; scoped: boolean }
>;

/** Chave de um papel (os de sistema estão em ROLES; os criados no painel têm outras). */
export type RoleKey = string;
export type SystemRoleKey = keyof typeof ROLES;
export const SYSTEM_ROLE_KEYS = Object.keys(ROLES) as SystemRoleKey[];
export const SUPER_ADMIN = 'super_admin';
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Quem acessa o painel precisa de verificação em duas etapas. */
export const requiresMfa = (permissions: readonly Permission[]) =>
  permissions.includes('admin.access');

/** Permissões agrupadas para a tela de papéis. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: 'Painel e pessoas',
    permissions: ['admin.access', 'users.read', 'users.manage', 'users.delete'],
  },
  { label: 'Organograma', permissions: ['org.manage'] },
  { label: 'Papéis e auditoria', permissions: ['roles.assign', 'roles.manage', 'audit.read'] },
  {
    label: 'Comunicação',
    permissions: ['broadcast.send', 'conversations.create_channel', 'messages.mention_all'],
  },
];

/** Papel como aparece no painel. */
export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  /** Vale numa unidade (e abaixo dela), em vez de no sistema todo. */
  scoped: boolean;
  /** Criado na instalação: não pode ser excluído. */
  isSystem: boolean;
  /** Super administrador: não pode ser alterado. */
  locked: boolean;
  permissions: Permission[];
  /** Quantas pessoas têm o papel hoje. */
  assignmentCount: number;
}

const permissionList = z
  .array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]))
  .min(1, 'Marque ao menos uma permissão');

export const createRoleSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome do papel').max(80),
  description: z.string().trim().max(240).default(''),
  scoped: z.boolean(),
  permissions: permissionList,
});
export type CreateRoleRequest = z.input<typeof createRoleSchema>;

export const updateRoleSchema = createRoleSchema.partial();
export type UpdateRoleRequest = z.input<typeof updateRoleSchema>;
