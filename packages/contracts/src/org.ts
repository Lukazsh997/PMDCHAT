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
