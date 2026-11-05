import { z } from 'zod';

export const ORG_UNIT_KINDS = {
  orgao: 'Órgão',
  secretaria: 'Secretaria',
  subsecretaria: 'Subsecretaria',
  coordenacao: 'Coordenação',
  setor: 'Setor',
  outro: 'Outro',
} as const;
export type OrgUnitKind = keyof typeof ORG_UNIT_KINDS;
export const orgUnitKindSchema = z.enum(
  Object.keys(ORG_UNIT_KINDS) as [OrgUnitKind, ...OrgUnitKind[]],
);

export interface OrgUnit {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  name: string;
  acronym: string | null;
  isActive: boolean;
  depth: number;
  memberCount: number;
}

/** Unidade no organograma visto por todos (só unidades ativas). */
export interface OrgTreeUnit {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  name: string;
  acronym: string | null;
  depth: number;
  /** Pessoas lotadas diretamente nesta unidade (sem contar as subunidades). */
  memberCount: number;
  /** Dessas, quantas estão conectadas agora. */
  onlineCount: number;
}

export interface OrgTree {
  units: OrgTreeUnit[];
  /** Pessoas ativas sem lotação. */
  unassigned: { memberCount: number; onlineCount: number };
}

export const createOrgUnitSchema = z.object({
  parentId: z.uuid().nullable(),
  kind: orgUnitKindSchema,
  name: z.string().trim().min(2, 'Informe o nome').max(160),
  acronym: z
    .string()
    .trim()
    .max(24)
    .transform((v) => v || null)
    .nullable()
    .optional(),
});
export type CreateOrgUnitRequest = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = createOrgUnitSchema.extend({ isActive: z.boolean() }).partial();
export type UpdateOrgUnitRequest = z.infer<typeof updateOrgUnitSchema>;
