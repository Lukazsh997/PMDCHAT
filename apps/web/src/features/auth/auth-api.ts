import type {
  ChangePasswordRequest,
  LoginRequest,
  MeResponse,
  SessionInfo,
} from '@plataforma/contracts';
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

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => api<MeResponse>('POST', '/auth/login', input),
    onSuccess: (me) => qc.setQueryData(meKey, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout'),
    onSettled: () => {
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
