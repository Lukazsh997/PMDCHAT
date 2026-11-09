import type {
  AdminStats,
  AdminUser,
  AdminUserList,
  AssignRoleRequest,
  AuditPage,
  CreateOrgUnitRequest,
  CreateRoleRequest,
  CreateUserRequest,
  CreateUserResponse,
  OrgUnit,
  RoleDefinition,
  UpdateOrgUnitRequest,
  UpdateRoleRequest,
  UpdateUserRequest,
  UserStatus,
} from '@plataforma/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const adminKeys = {
  stats: ['admin', 'stats'] as const,
  users: (q: object) => ['admin', 'users', q] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  audit: (q: object) => ['admin', 'audit', q] as const,
  org: ['org-units'] as const,
  roles: ['admin', 'roles'] as const,
};

export const useRoles = () =>
  useQuery({
    queryKey: adminKeys.roles,
    queryFn: () => api<RoleDefinition[]>('GET', '/admin/roles'),
    staleTime: 30_000,
  });

export function useRoleMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: adminKeys.roles });
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
  return {
    create: useMutation({
      mutationFn: (b: CreateRoleRequest) => api<RoleDefinition>('POST', '/admin/roles', b),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { key: string; body: UpdateRoleRequest }) =>
        api<RoleDefinition>('PATCH', `/admin/roles/${v.key}`, v.body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (key: string) => api<void>('DELETE', `/admin/roles/${key}`),
      onSuccess: refresh,
    }),
  };
}

const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const useStats = () =>
  useQuery({ queryKey: adminKeys.stats, queryFn: () => api<AdminStats>('GET', '/admin/stats') });

export const useOrgUnits = () =>
  useQuery({
    queryKey: adminKeys.org,
    queryFn: () => api<OrgUnit[]>('GET', '/org-units'),
    staleTime: 60_000,
  });

export function useUsers(q: { q?: string; orgUnitId?: string; status?: UserStatus; page: number }) {
  return useQuery({
    queryKey: adminKeys.users(q),
    queryFn: () => api<AdminUserList>('GET', `/admin/users?${qs({ ...q, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
}

export const useAdminUser = (id: string | null) =>
  useQuery({
    queryKey: adminKeys.user(id ?? ''),
    queryFn: () => api<AdminUser>('GET', `/admin/users/${id}`),
    enabled: !!id,
  });

export function useAudit(q: { action?: string; from?: string; to?: string; page: number }) {
  return useQuery({
    queryKey: adminKeys.audit(q),
    queryFn: () => api<AuditPage>('GET', `/admin/audit?${qs({ ...q, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
}

/** Mutações do painel: ao concluir, atualizam o usuário e recarregam as listas. */
export function useUserMutations() {
  const qc = useQueryClient();
  const refresh = (u?: AdminUser) => {
    if (u) qc.setQueryData(adminKeys.user(u.id), u);
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: adminKeys.stats });
  };
  return {
    create: useMutation({
      mutationFn: (b: CreateUserRequest) => api<CreateUserResponse>('POST', '/admin/users', b),
      onSuccess: (r) => refresh(r.user),
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: UpdateUserRequest }) =>
        api<AdminUser>('PATCH', `/admin/users/${v.id}`, v.body),
      onSuccess: refresh,
    }),
    status: useMutation({
      mutationFn: (v: { id: string; status: UserStatus }) =>
        api<AdminUser>('POST', `/admin/users/${v.id}/status`, { status: v.status }),
      onSuccess: refresh,
    }),
    resetPassword: useMutation({
      mutationFn: (id: string) =>
        api<{ temporaryPassword: string }>('POST', `/admin/users/${id}/reset-password`),
    }),
    resetMfa: useMutation({
      mutationFn: (id: string) => api<void>('POST', `/admin/users/${id}/reset-mfa`),
      onSuccess: (_, id) => void qc.invalidateQueries({ queryKey: adminKeys.user(id) }),
    }),
    assignRole: useMutation({
      mutationFn: (v: { id: string; body: AssignRoleRequest }) =>
        api<AdminUser>('POST', `/admin/users/${v.id}/roles`, v.body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (v: { id: string; confirmUsername: string }) =>
        api<void>('DELETE', `/admin/users/${v.id}`, { confirmUsername: v.confirmUsername }),
      onSuccess: (_, v) => {
        qc.removeQueries({ queryKey: adminKeys.user(v.id) });
        refresh();
      },
    }),
    removeAvatar: useMutation({
      mutationFn: (id: string) => api<AdminUser>('DELETE', `/admin/users/${id}/avatar`),
      onSuccess: (u) => {
        refresh(u);
        void qc.invalidateQueries({ queryKey: adminKeys.roles });
      },
    }),
    removeRole: useMutation({
      mutationFn: (v: { id: string; assignmentId: string }) =>
        api<AdminUser>('DELETE', `/admin/users/${v.id}/roles/${v.assignmentId}`),
      onSuccess: refresh,
    }),
  };
}

export function useOrgMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: adminKeys.org });
  return {
    create: useMutation({
      mutationFn: (b: CreateOrgUnitRequest) => api<OrgUnit>('POST', '/org-units', b),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: UpdateOrgUnitRequest }) =>
        api<OrgUnit>('PATCH', `/org-units/${v.id}`, v.body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>('DELETE', `/org-units/${id}`),
      onSuccess: refresh,
    }),
  };
}
