import type {
  BroadcastPreview,
  BroadcastResult,
  BroadcastScopes,
  DirectoryUser,
  OrgTree,
  OrgTreeUnit,
  SendBroadcastRequest,
} from '@plataforma/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSocket } from '@/lib/socket';
import { api } from '@/lib/api';

export const orgKeys = {
  tree: ['org-tree'] as const,
  people: (unitId: string) => ['org-people', unitId] as const,
  search: (q: string) => ['org-search', q] as const,
  scopes: ['broadcast-scopes'] as const,
};

/** Unidade com filhos e totais da subárvore, para desenhar o organograma. */
export interface TreeNode extends OrgTreeUnit {
  children: TreeNode[];
  /** Pessoas da unidade e de todas as subunidades. */
  totalMembers: number;
  totalOnline: number;
  /** Caminho a partir da raiz (sem a própria unidade). */
  ancestors: OrgTreeUnit[];
}

export function useOrgTree() {
  const q = useQuery({
    queryKey: orgKeys.tree,
    queryFn: () => api<OrgTree>('GET', '/directory/org-tree'),
    // As contagens de "online" acompanham quem entra e sai sem recarregar a página.
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  const model = useMemo(() => (q.data ? buildTree(q.data.units) : null), [q.data]);
  // Ao (re)conectar, a própria pessoa passa a contar como online: atualiza as contagens.
  const qc = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries({ queryKey: orgKeys.tree }), 800);
    };
    if (socket.connected) refresh();
    socket.on('connect', refresh);
    return () => {
      clearTimeout(timer);
      socket.off('connect', refresh);
    };
  }, [qc]);
  return { ...q, model };
}

export function buildTree(units: OrgTreeUnit[]) {
  const byId = new Map<string, TreeNode>();
  for (const u of units)
    byId.set(u.id, { ...u, children: [], totalMembers: 0, totalOnline: 0, ancestors: [] });
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, 'pt-BR');
  const walk = (n: TreeNode, path: OrgTreeUnit[]) => {
    n.ancestors = path;
    n.children.sort(byName);
    n.totalMembers = n.memberCount;
    n.totalOnline = n.onlineCount;
    for (const c of n.children) {
      walk(c, [...path, n]);
      n.totalMembers += c.totalMembers;
      n.totalOnline += c.totalOnline;
    }
  };
  roots.sort(byName);
  for (const r of roots) walk(r, []);
  return { roots, byId };
}

/** Pessoas lotadas diretamente na unidade (carregadas ao abrir a unidade). */
export function useUnitPeople(unitId: string | null, enabled = true) {
  return useQuery({
    queryKey: orgKeys.people(unitId ?? ''),
    queryFn: () =>
      api<DirectoryUser[]>('GET', `/directory/users?orgUnitId=${unitId}&scope=direct&limit=500`),
    enabled: !!unitId && enabled,
    staleTime: 60_000,
  });
}

export function usePeopleSearch(q: string) {
  return useQuery({
    queryKey: orgKeys.search(q),
    queryFn: () =>
      api<DirectoryUser[]>('GET', `/directory/users?q=${encodeURIComponent(q)}&limit=30`),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useBroadcastScopes() {
  return useQuery({
    queryKey: orgKeys.scopes,
    queryFn: () => api<BroadcastScopes>('GET', '/broadcasts/scopes'),
    staleTime: 5 * 60_000,
  });
}

/** Pode enviar comunicado para esta unidade? (escopo na própria unidade ou acima dela) */
export function canBroadcastTo(scopes: BroadcastScopes | undefined, node: TreeNode): boolean {
  if (!scopes) return false;
  if (scopes.global) return true;
  return [...node.ancestors.map((a) => a.id), node.id].some((id) => scopes.unitIds.includes(id));
}

export function useBroadcastPreview(unitId: string, includeSubunits: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ['broadcast-preview', unitId, includeSubunits],
    queryFn: () =>
      api<BroadcastPreview>(
        'GET',
        `/broadcasts/preview?orgUnitId=${unitId}&includeSubunits=${includeSubunits}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSendBroadcast() {
  return useMutation({
    mutationFn: (input: SendBroadcastRequest) => api<BroadcastResult>('POST', '/broadcasts', input),
  });
}
