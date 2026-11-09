import type {
  LdapGroup,
  LdapOu,
  LdapPreview,
  LdapSettings,
  LdapSyncRun,
  LdapTestResult,
  UpdateLdapSettingsRequest,
} from '@plataforma/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const keys = {
  settings: ['admin', 'ldap', 'settings'] as const,
  ous: ['admin', 'ldap', 'ous'] as const,
  groups: ['admin', 'ldap', 'groups'] as const,
  runs: ['admin', 'ldap', 'runs'] as const,
};

export const useLdapSettings = () =>
  useQuery({
    queryKey: keys.settings,
    queryFn: () => api<LdapSettings>('GET', '/admin/ldap/settings'),
  });

/** OUs e grupos só carregam com a conexão salva (o servidor precisa da senha guardada). */
export const useLdapOus = (enabled: boolean) =>
  useQuery({
    queryKey: keys.ous,
    queryFn: () => api<LdapOu[]>('GET', '/admin/ldap/ous'),
    enabled,
    retry: false,
  });

export const useLdapGroups = (enabled: boolean) =>
  useQuery({
    queryKey: keys.groups,
    queryFn: () => api<LdapGroup[]>('GET', '/admin/ldap/groups'),
    enabled,
    retry: false,
  });

export const useLdapRuns = () =>
  useQuery({
    queryKey: keys.runs,
    queryFn: () => api<LdapSyncRun[]>('GET', '/admin/ldap/runs'),
    refetchInterval: 30_000,
  });

export function useLdapMutations() {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (b: UpdateLdapSettingsRequest) =>
        api<LdapSettings>('PUT', '/admin/ldap/settings', b),
      onSuccess: (s) => {
        qc.setQueryData(keys.settings, s);
        void qc.invalidateQueries({ queryKey: keys.ous });
        void qc.invalidateQueries({ queryKey: keys.groups });
      },
    }),
    test: useMutation({
      mutationFn: (b: UpdateLdapSettingsRequest) =>
        api<LdapTestResult>('POST', '/admin/ldap/test', b),
    }),
    saveOus: useMutation({
      mutationFn: (mappings: { dn: string; orgUnitId: string }[]) =>
        api<{ saved: number }>('PUT', '/admin/ldap/ous', { mappings }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: keys.ous }),
    }),
    saveGroups: useMutation({
      mutationFn: (mappings: { dn: string; role: string; orgUnitId: string | null }[]) =>
        api<{ saved: number }>('PUT', '/admin/ldap/groups', { mappings }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: keys.groups }),
    }),
    preview: useMutation({
      mutationFn: () => api<LdapPreview>('POST', '/admin/ldap/preview'),
    }),
    sync: useMutation({
      mutationFn: (confirmLargeChanges: boolean) =>
        api<LdapSyncRun>('POST', '/admin/ldap/sync', { confirmLargeChanges }),
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: keys.runs });
        void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      },
    }),
  };
}
