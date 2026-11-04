/**
 * Catálogo de permissões e papéis do sistema.
 *
 * Fase 1: papéis fixos, definidos em código. Cada atribuição liga um usuário a um
 * papel com escopo global ou numa unidade organizacional (incluindo as unidades
 * abaixo dela). A edição de papéis personalizados entra na Fase 2.
 */
export const PERMISSIONS = {
  'admin.access': 'Acessar o painel administrativo',
  'users.read': 'Consultar usuários no painel',
  'users.manage': 'Criar, editar, bloquear usuários e gerar senha temporária',
  'org.manage': 'Gerenciar secretarias, subsecretarias e setores',
  'roles.assign': 'Atribuir e remover papéis',
  'audit.read': 'Consultar o registro de auditoria',
  'messages.delete_any': 'Apagar mensagens de qualquer pessoa (moderação)',
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
    permissions: ['admin.access', 'users.read', 'users.manage'] as Permission[],
    scoped: true,
  },
  auditor: {
    name: 'Auditor',
    description: 'Consulta usuários e o registro de auditoria, sem alterar nada',
    permissions: ['admin.access', 'users.read', 'audit.read'] as Permission[],
    scoped: false,
  },
  moderator: {
    name: 'Moderador',
    description: 'Pode apagar mensagens de qualquer conversa',
    permissions: ['messages.delete_any'] as Permission[],
    scoped: false,
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: Permission[]; scoped: boolean }
>;

export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/** Papéis que exigem verificação em duas etapas (acessam o painel). */
export const roleRequiresMfa = (role: RoleKey) =>
  (ROLES[role].permissions as readonly Permission[]).includes('admin.access');
