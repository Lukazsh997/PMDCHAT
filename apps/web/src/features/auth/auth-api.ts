import type {
  ChangePasswordRequest,
  LoginMfaChallenge,
  LoginRequest,
  MeResponse,
  MfaSetupResponse,
  OrgUnit,
  SessionInfo,
} from '@plataforma/contracts';
import { dropPushSubscription } from '@/lib/push';
import { closeSocket } from '@/lib/socket';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/lib/api';

export const meKey = ['auth', 'me'] as const;
export const sessionsKey = ['auth', 'sessions'] as const;

/** Usuário logado, ou `null` sem sessão. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await api<MeResponse>('GET', '/auth/me');
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: (count, e) => !(e instanceof ApiRequestError && e.status > 0) && count < 2,
  });
}

type LoginResult = MeResponse | LoginMfaChallenge;
export const isMfaChallenge = (r: LoginResult): r is LoginMfaChallenge => 'challengeId' in r;

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => api<LoginResult>('POST', '/auth/login', input),
    onSuccess: (r) => !isMfaChallenge(r) && qc.setQueryData(meKey, r),
  });
}

export function useLoginMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { challengeId: string; code: string }) =>
      api<MeResponse>('POST', '/auth/login/mfa', input),
    onSuccess: (me) => qc.setQueryData(meKey, me),
  });
}

export function useMfaSetup() {
  return useMutation({ mutationFn: () => api<MfaSetupResponse>('POST', '/auth/mfa/setup') });
}

export function useMfaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<void>('POST', '/auth/mfa/enable', { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useMfaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api<void>('POST', '/auth/mfa/disable', { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Este navegador para de receber avisos desta conta antes de a sessão acabar.
      await dropPushSubscription();
      await api<void>('POST', '/auth/logout');
    },
    onSettled: () => {
      closeSocket();
      // Marca "sem sessão" (a tela observa esta chave) e descarta o resto do cache.
      qc.setQueryData(meKey, null);
      qc.removeQueries({ predicate: (q) => q.queryKey.join('/') !== meKey.join('/') });
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordRequest) => api<void>('POST', '/auth/password', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => api<SessionInfo[]>('GET', '/auth/sessions'),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export function useOnboardingOrgUnits() {
  return useQuery({
    queryKey: ['auth', 'onboarding', 'org-units'],
    queryFn: () => api<OrgUnit[]>('GET', '/auth/onboarding/org-units'),
  });
}

export function useChooseOrgUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgUnitId: string) =>
      api<void>('POST', '/auth/onboarding/org-unit', { orgUnitId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  });
}
