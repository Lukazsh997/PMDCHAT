import { z } from 'zod';

/**
 * Lista de lotação (Fase 3): um arquivo com quem trabalha em cada setor de cada
 * secretaria — a exportação de outro sistema (INSERTs .sql) ou uma planilha .csv.
 * A importação monta o organograma, lota as pessoas e, com o AD, passa a dizer quem
 * pode ter conta: quem é do AD e não está na lista sai do sistema.
 */

export const ROSTER_LIMITS = {
  /** Tamanho máximo do arquivo, em caracteres. */
  maxChars: 8_000_000,
  maxRows: 50_000,
  /** Quantas mudanças de pessoa a prévia mostra. */
  maxListed: 500,
  /** Acima desta fração das contas do AD, a remoção pede confirmação. */
  maxRemoveFraction: 0.3,
} as const;

/** Colunas reconhecidas no arquivo (o nome pode variar; as demais são ignoradas). */
export const ROSTER_COLUMNS = {
  username: ['username', 'login', 'usuario', 'matricula', 'samaccountname', 'user'],
  displayName: ['nome', 'name', 'displayname', 'nome_completo', 'nomecompleto'],
  secretaria: ['unidade', 'secretaria', 'orgao', 'unidade_nome', 'secretaria_nome'],
  setor: ['setor', 'departamento', 'setor_nome', 'lotacao'],
  setorId: ['setor_id', 'id_setor', 'cod_setor', 'codigo_setor', 'setorid'],
} as const;

/**
 * O que fazer com cada secretaria do arquivo:
 * - `existing:<id>`: é esta unidade do organograma;
 * - `create`: criar uma secretaria com este nome;
 * - `alias:<nome no arquivo>`: é a mesma secretaria que outro nome do arquivo
 *   (ex.: "FAZENDA" e "SMF").
 */
export const rosterSecretariaDecisionSchema = z
  .string()
  .regex(/^(existing:[0-9a-f-]{36}|create|alias:.{1,200})$/);

export const rosterPlanSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(ROSTER_LIMITS.maxChars),
  /** Decisão por nome de secretaria do arquivo; o que faltar usa a sugestão. */
  secretarias: z.record(z.string().max(200), rosterSecretariaDecisionSchema).default({}),
  /** Setor (chave da prévia) → nome da secretaria do arquivo onde ele fica. */
  setores: z.record(z.string().max(300), z.string().max(200)).default({}),
  /** Onde criar as secretarias novas (null = no topo do organograma). */
  parentId: z.uuid().nullable().optional(),
  /** O que fazer com quem é do AD e não está na lista. */
  removal: z.enum(['delete', 'disable']).default('delete'),
});
export type RosterPlanRequest = z.input<typeof rosterPlanSchema>;

export const rosterApplySchema = rosterPlanSchema.extend({
  /** Seguir mesmo removendo muitas contas de uma vez. */
  confirmLargeRemoval: z.boolean().default(false),
});
export type RosterApplyRequest = z.input<typeof rosterApplySchema>;

export interface RosterSecretaria {
  /** Nome como está no arquivo. */
  raw: string;
  people: number;
  decision: string;
  /** Para onde vai, em palavras (ex.: "Secretaria de Fazenda (existente)"). */
  target: string;
}

export interface RosterSetor {
  key: string;
  name: string;
  /** Secretaria do arquivo escolhida (a mais frequente, ou a que o administrador mudou). */
  secretaria: string | null;
  /** Outras secretarias com que o mesmo setor aparece no arquivo. */
  alternatives: { secretaria: string; people: number }[];
  people: number;
  /** Unidade do organograma onde o setor fica. */
  unitId: string | null;
  isNew: boolean;
}

export interface RosterPersonChange {
  username: string;
  displayName: string;
  from: string | null;
  to: string | null;
}

export interface RosterPlan {
  fileName: string;
  /** Formato reconhecido do arquivo. */
  format: 'sql' | 'csv';
  rows: number;
  parentId: string | null;
  secretarias: RosterSecretaria[];
  setores: RosterSetor[];
  unitsToCreate: number;
  people: {
    /** Pessoas na lista (sem repetir login). */
    total: number;
    /** Já têm conta: mudam de lotação. */
    moved: number;
    unchanged: number;
    /** Ainda sem conta: entram quando a conta vier do AD (sincronização ou 1º login). */
    withoutAccount: number;
    changes: RosterPersonChange[];
  };
  removal: {
    mode: 'delete' | 'disable';
    count: number;
    people: { username: string; displayName: string }[];
    needsConfirmation: boolean;
  };
  /** Linhas ignoradas e outros avisos. */
  problems: string[];
}

export interface RosterApplyResult {
  created: number;
  moved: number;
  removed: number;
  entries: number;
}

export interface RosterStatus {
  /** A lotação vem da lista (e ela diz quem pode ter conta pelo AD). */
  active: boolean;
  entries: number;
  lastImport: { fileName: string; at: string; actorName: string | null } | null;
}
