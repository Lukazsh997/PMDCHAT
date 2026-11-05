import { Inject, Injectable } from '@nestjs/common';
import {
  LDAP_DEFAULTS,
  type LdapSettings,
  type updateLdapSettingsSchema,
} from '@plataforma/contracts';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { SecretBox } from '../../common/crypto.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { DB, type Database } from '../../database/database.js';
import { ldapSettings } from '../../database/schema/index.js';
import { type DirectoryConfig, LdapGateway } from './ldap.gateway.js';

type Row = typeof ldapSettings.$inferSelect;
type Update = z.output<typeof updateLdapSettingsSchema>;

/** Configuração do AD (uma linha). A senha da conta de serviço fica cifrada com APP_SECRET. */
@Injectable()
export class LdapSettingsService {
  private readonly box: SecretBox;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {
    this.box = new SecretBox(config.APP_SECRET!);
  }

  async row(): Promise<Row> {
    const [r] = await this.db.select().from(ldapSettings).where(eq(ldapSettings.id, 1)).limit(1);
    if (r) return r;
    const [created] = await this.db
      .insert(ldapSettings)
      .values({
        id: 1,
        userFilter: LDAP_DEFAULTS.userFilter,
        usernameAttribute: LDAP_DEFAULTS.usernameAttribute,
        displayNameAttribute: LDAP_DEFAULTS.displayNameAttribute,
        emailAttribute: LDAP_DEFAULTS.emailAttribute,
        jobTitleAttribute: LDAP_DEFAULTS.jobTitleAttribute,
        syncIntervalMinutes: LDAP_DEFAULTS.syncIntervalMinutes,
      })
      .onConflictDoNothing()
      .returning();
    return created ?? (await this.row());
  }

  async get(): Promise<LdapSettings> {
    return toDto(await this.row());
  }

  async update(input: Update, actorId: string): Promise<LdapSettings> {
    await this.row();
    const [r] = await this.db
      .update(ldapSettings)
      .set({
        enabled: input.enabled,
        url: input.url,
        startTls: input.startTls,
        tlsVerify: input.tlsVerify,
        caCert: input.caCert,
        bindDn: input.bindDn,
        ...(input.bindPassword ? { bindPasswordEnc: this.box.seal(input.bindPassword) } : {}),
        baseDn: input.baseDn,
        userFilter: input.userFilter,
        usernameAttribute: input.usernameAttribute,
        displayNameAttribute: input.displayNameAttribute,
        emailAttribute: input.emailAttribute,
        jobTitleAttribute: input.jobTitleAttribute,
        defaultOrgUnitId: input.defaultOrgUnitId,
        autoProvision: input.autoProvision,
        syncIntervalMinutes: input.syncIntervalMinutes,
        updatedBy: actorId,
      })
      .where(eq(ldapSettings.id, 1))
      .returning();
    return toDto(r!);
  }

  /** Cliente do AD com a configuração atual (ou a que está sendo testada). */
  gateway(r: Row, overridePassword?: string): LdapGateway {
    return new LdapGateway(this.directoryConfig(r, overridePassword));
  }

  /** Configuração pronta para uso, ou null se a integração está desligada/incompleta. */
  async activeGateway(): Promise<{ row: Row; gateway: LdapGateway } | null> {
    const r = await this.row();
    if (!r.enabled || !r.url || !r.baseDn || !r.bindDn || !r.bindPasswordEnc) return null;
    return { row: r, gateway: this.gateway(r) };
  }

  /** Para o painel: exige integração configurada, mesmo que ainda desligada. */
  async requireGateway(): Promise<{ row: Row; gateway: LdapGateway }> {
    const r = await this.row();
    if (!r.url || !r.baseDn || !r.bindDn || !r.bindPasswordEnc) {
      throw new AppException(
        409,
        'CONFLICT',
        'Preencha e salve a conexão com o Active Directory primeiro.',
      );
    }
    return { row: r, gateway: this.gateway(r) };
  }

  private directoryConfig(r: Row, overridePassword?: string): DirectoryConfig {
    return {
      url: r.url,
      startTls: r.startTls,
      tlsVerify: r.tlsVerify,
      caCert: r.caCert,
      bindDn: r.bindDn,
      bindPassword: overridePassword ?? (r.bindPasswordEnc ? this.box.open(r.bindPasswordEnc) : ''),
      baseDn: r.baseDn,
      userFilter: r.userFilter,
      usernameAttribute: r.usernameAttribute,
      displayNameAttribute: r.displayNameAttribute,
      emailAttribute: r.emailAttribute,
      jobTitleAttribute: r.jobTitleAttribute,
    };
  }
}

function toDto(r: Row): LdapSettings {
  return {
    enabled: r.enabled,
    url: r.url,
    startTls: r.startTls,
    tlsVerify: r.tlsVerify,
    caCert: r.caCert,
    bindDn: r.bindDn,
    hasBindPassword: !!r.bindPasswordEnc,
    baseDn: r.baseDn,
    userFilter: r.userFilter,
    usernameAttribute: r.usernameAttribute,
    displayNameAttribute: r.displayNameAttribute,
    emailAttribute: r.emailAttribute,
    jobTitleAttribute: r.jobTitleAttribute,
    defaultOrgUnitId: r.defaultOrgUnitId,
    autoProvision: r.autoProvision,
    syncIntervalMinutes: r.syncIntervalMinutes,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}
