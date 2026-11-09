import type {
  RosterApplyRequest,
  RosterApplyResult,
  RosterPlan,
  RosterPlanRequest,
  RosterStatus,
} from '@plataforma/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const key = ['admin', 'roster'] as const;

export const useRosterStatus = () =>
  useQuery({ queryKey: key, queryFn: () => api<RosterStatus>('GET', '/admin/roster') });

export function useRosterMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['admin', 'ldap'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: ['org-units'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    void qc.invalidateQueries({ queryKey: ['org-tree'] });
  };
  return {
    preview: useMutation({
      mutationFn: (b: RosterPlanRequest) => api<RosterPlan>('POST', '/admin/roster/preview', b),
    }),
    apply: useMutation({
      mutationFn: (b: RosterApplyRequest) =>
        api<RosterApplyResult>('POST', '/admin/roster/apply', b),
      onSuccess: refresh,
    }),
    deactivate: useMutation({
      mutationFn: () => api<RosterStatus>('POST', '/admin/roster/deactivate'),
      onSuccess: refresh,
    }),
    selfSignup: useMutation({
      mutationFn: (enabled: boolean) =>
        api<RosterStatus>('POST', '/admin/roster/self-signup', { enabled }),
      onSuccess: refresh,
    }),
  };
}
