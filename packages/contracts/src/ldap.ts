import { z } from 'zod';

/**
 * Integração com o Active Directory (Fase 3): login com a senha do AD, sincronização
 * de pessoas, OUs → unidades do organograma e grupos → papéis.
 */

/** Configuração como o painel a vê. A senha da conta de serviço nunca volta para a tela. */
export interface LdapSettings {
  enabled: boolean;
  /** ldaps://ad.orgao.local:636 (recomendado) ou ldap://ad.orgao.local:389 com StartTLS. */
  url: string;
  startTls: boolean;
  /** Conferir o certificado do AD (desligar só para testes). */
  tlsVerify: boolean;
  /** Certificado da AC interna, em PEM, quando o AD usa uma AC própria. */
  caCert: string | null;
  bindDn: string;
  hasBindPassword: boolean;
  /** Onde procurar pessoas, ex.: OU=Prefeitura,DC=orgao,DC=local */
  baseDn: string;
  userFilter: string;
  usernameAttribute: string;
  displayNameAttribute: string;
  emailAttribute: string;
  jobTitleAttribute: string;
  /** Unidade de quem está numa OU sem mapeamento (null = mantém a lotação atual). */
  defaultOrgUnitId: string | null;
  /** Cria a conta de quem existe no AD e ainda não está no sistema (na sincronização e no 1º login). */
  autoProvision: boolean;
  syncIntervalMinutes: number;
  updatedAt: string | null;
}

export const LDAP_DEFAULTS = {
  userFilter: '(&(objectCategory=person)(objectClass=user))',
  usernameAttribute: 'sAMAccountName',
  displayNameAttribute: 'displayName',
  emailAttribute: 'mail',
  jobTitleAttribute: 'title',
  syncIntervalMinutes: 60,
  /** A sincronização para (e pede confirmação) se for desativar mais do que isto. */
  maxDisableFraction: 0.3,
} as const;

const dn = z.string().trim().max(1000);

export const updateLdapSettingsSchema = z.object({
  enabled: z.boolean(),
  url: z
    .string()
    .trim()
    .regex(/^ldaps?:\/\/[^\s/]+$/i, 'Use ldaps://servidor:636 ou ldap://servidor:389'),
  startTls: z.boolean(),
  tlsVerify: z.boolean(),
  caCert: z
    .string()
    .trim()
    .max(20_000)
    .transform((v) => v || null)
    .nullable(),
  bindDn: dn.min(3, 'Informe a conta de serviço'),
  /** Vazio = manter a senha guardada. */
  bindPassword: z.string().max(512).optional(),
  baseDn: dn.min(3, 'Informe onde procurar as pessoas'),
  userFilter: z.string().trim().min(3).max(1000),
  usernameAttribute: z.string().trim().min(1).max(64),
  displayNameAttribute: z.string().trim().min(1).max(64),
  emailAttribute: z.string().trim().min(1).max(64),
  jobTitleAttribute: z.string().trim().min(1).max(64),
  defaultOrgUnitId: z.uuid().nullable(),
  autoProvision: z.boolean(),
  syncIntervalMinutes: z.number().int().min(15).max(1440),
});
export type UpdateLdapSettingsRequest = z.input<typeof updateLdapSettingsSchema>;

export interface LdapTestResult {
  ok: boolean;
  message: string;
  userCount?: number;
  sample?: { username: string; displayName: string; dn: string }[];
}

/** OU encontrada no AD, com a unidade a que está ligada (ou uma sugestão pelo nome). */
export interface LdapOu {
  dn: string;
  name: string;
  depth: number;
  orgUnitId: string | null;
  suggestedOrgUnitId: string | null;
}

export const ouMappingsSchema = z.object({
  mappings: z.array(z.object({ dn, orgUnitId: z.uuid() })).max(5000),
});

export interface LdapGroup {
  dn: string;
  name: string;
  description: string | null;
  mappings: { role: string; orgUnitId: string | null }[];
}

export const groupMappingsSchema = z.object({
  mappings: z
    .array(z.object({ dn, role: z.string().min(1).max(32), orgUnitId: z.uuid().nullable() }))
    .max(1000),
});

export type LdapChangeKind = 'create' | 'update' | 'disable' | 'reenable' | 'roles';

export interface LdapChange {
  kind: LdapChangeKind;
  username: string;
  displayName: string;
  /** O que muda, em palavras (ex.: "lotação: DCA → CPA"). */
  details: string[];
}

export interface LdapSyncSummary {
  created: number;
  updated: number;
  disabled: number;
  reenabled: number;
  roleChanges: number;
  unchanged: number;
  /** Pessoas do AD que não puderam ser importadas (ex.: e-mail já usado). */
  problems: string[];
  /** A sincronização desativaria gente demais: só segue com confirmação. */
  needsConfirmation: boolean;
}

export interface LdapPreview extends LdapSyncSummary {
  changes: LdapChange[];
  /** Mostramos no máximo este número de mudanças. */
  truncated: boolean;
}

export interface LdapSyncRun {
  id: string;
  trigger: 'manual' | 'schedule';
  status: 'running' | 'success' | 'failed' | 'blocked';
  startedAt: string;
  finishedAt: string | null;
  summary: LdapSyncSummary | null;
  error: string | null;
  actorName: string | null;
}

export const runSyncSchema = z.object({
  /** Seguir mesmo se a sincronização for desativar muita gente. */
  confirmLargeChanges: z.boolean().default(false),
});
