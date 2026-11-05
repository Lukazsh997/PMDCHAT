import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import {
  groupMappingsSchema,
  type LdapGroup,
  type LdapOu,
  type LdapPreview,
  type LdapSettings,
  type LdapSyncRun,
  type LdapTestResult,
  ouMappingsSchema,
  runSyncSchema,
  updateLdapSettingsSchema,
} from '@plataforma/contracts';
import { asc } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { clientInfo } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Database } from '../../database/database.js';
import { ldapGroupMappings, ldapOuMappings, orgUnits, roles } from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import { RequirePermission } from '../rbac/index.js';
import { DirectoryUnavailableError } from './ldap.gateway.js';
import { LdapSettingsService } from './ldap-settings.service.js';
import { LdapSyncService } from './ldap-sync.service.js';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Painel → Active Directory. Só quem pode configurar integrações (super administrador). */
@Controller('admin/ldap')
@RequirePermission('settings.manage')
export class LdapController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: LdapSettingsService,
    private readonly sync: LdapSyncService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings')
  get(): Promise<LdapSettings> {
    return this.settings.get();
  }

  @Put('settings')
  async update(
    @Body(new ZodPipe(updateLdapSettingsSchema)) body: z.output<typeof updateLdapSettingsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<LdapSettings> {
    const saved = await this.settings.update(body, req.auth!.user.id);
    await this.audit.record({
      action: 'ldap.settings_changed',
      actorId: req.auth!.user.id,
      entityType: 'ldap',
      ...clientInfo(req),
      // A senha nunca vai para a auditoria.
      metadata: {
        enabled: body.enabled,
        url: body.url,
        bindDn: body.bindDn,
        baseDn: body.baseDn,
        passwordChanged: !!body.bindPassword,
      },
    });
    return saved;
  }

  /** Testa com os dados da tela (sem salvar); sem senha nova, usa a guardada. */
  @Post('test')
  @HttpCode(200)
  async test(
    @Body(new ZodPipe(updateLdapSettingsSchema)) body: z.output<typeof updateLdapSettingsSchema>,
  ): Promise<LdapTestResult> {
    const current = await this.settings.row();
    if (!body.bindPassword && !current.bindPasswordEnc) {
      return { ok: false, message: 'Informe a senha da conta de serviço.' };
    }
    const gateway = this.settings.gateway({ ...current, ...body }, body.bindPassword || undefined);
    try {
      const r = await gateway.test();
      return {
        ok: true,
        message:
          r.count === 0
            ? 'Conectou, mas a busca não encontrou ninguém. Confira a base de busca e o filtro.'
            : `Conectou. A busca encontrou ${r.count} ${r.count === 1 ? 'pessoa' : 'pessoas'}${r.skipped ? ` (${r.skipped} ignoradas por login fora do padrão)` : ''}.`,
        userCount: r.count,
        sample: r.sample.map((p) => ({
          username: p.username,
          displayName: p.displayName,
          dn: p.dn,
        })),
      };
    } catch (e) {
      if (e instanceof DirectoryUnavailableError) return { ok: false, message: e.message };
      throw e;
    }
  }

  /** OUs do AD, com a unidade ligada a cada uma ou uma sugestão pelo nome/sigla. */
  @Get('ous')
  async ous(): Promise<LdapOu[]> {
    const { row, gateway } = await this.settings.requireGateway();
    const [ous, maps, units] = await Promise.all([
      this.directory(() => gateway.listOus()),
      this.db.select().from(ldapOuMappings),
      this.db
        .select({ id: orgUnits.id, name: orgUnits.name, acronym: orgUnits.acronym })
        .from(orgUnits),
    ]);
    const mapped = new Map(maps.map((m) => [m.dn, m.orgUnitId]));
    const byName = new Map<string, string>();
    for (const u of units) {
      byName.set(normalize(u.name), u.id);
      if (u.acronym) byName.set(normalize(u.acronym), u.id);
    }
    const baseDepth = row.baseDn.split(/(?<!\\),/).length;
    return ous
      .map((o) => ({
        dn: o.dn,
        name: o.name,
        depth: Math.max(0, o.dn.split(/(?<!\\),/).length - baseDepth - 1),
        orgUnitId: mapped.get(o.dn.toLowerCase()) ?? null,
        suggestedOrgUnitId: byName.get(normalize(o.name)) ?? null,
      }))
      .sort((a, b) => reversedDn(a.dn).localeCompare(reversedDn(b.dn)));
  }

  @Put('ous')
  async saveOus(
    @Body(new ZodPipe(ouMappingsSchema)) body: z.output<typeof ouMappingsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ saved: number }> {
    await this.db.transaction(async (tx) => {
      await tx.delete(ldapOuMappings);
      if (body.mappings.length) {
        await tx
          .insert(ldapOuMappings)
          .values(body.mappings.map((m) => ({ dn: m.dn.toLowerCase(), orgUnitId: m.orgUnitId })))
          .onConflictDoNothing();
      }
    });
    await this.audit.record({
      action: 'ldap.mappings_changed',
      actorId: req.auth!.user.id,
      entityType: 'ldap',
      ...clientInfo(req),
      metadata: { kind: 'ou', count: body.mappings.length },
    });
    return { saved: body.mappings.length };
  }

  @Get('groups')
  async groups(): Promise<LdapGroup[]> {
    const { gateway } = await this.settings.requireGateway();
    const [groups, maps] = await Promise.all([
      this.directory(() => gateway.listGroups()),
      this.db.select().from(ldapGroupMappings),
    ]);
    return groups
      .map((g) => ({
        dn: g.dn,
        name: g.name,
        description: g.description,
        mappings: maps
          .filter((m) => m.dn.toLowerCase() === g.dn.toLowerCase())
          .map((m) => ({ role: m.role, orgUnitId: m.orgUnitId })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  @Put('groups')
  async saveGroups(
    @Body(new ZodPipe(groupMappingsSchema)) body: z.output<typeof groupMappingsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ saved: number }> {
    const all = await this.db.select().from(roles).orderBy(asc(roles.key));
    for (const m of body.mappings) {
      const role = all.find((r) => r.key === m.role);
      if (!role) throw new AppException(400, 'VALIDATION_FAILED', `Papel desconhecido: ${m.role}`);
      if (role.key === 'super_admin') {
        throw new AppException(
          400,
          'VALIDATION_FAILED',
          'O papel de super administrador não pode vir de um grupo do AD: atribua no painel.',
        );
      }
      if (role.scoped && !m.orgUnitId) {
        throw new AppException(
          400,
          'VALIDATION_FAILED',
          `O papel "${role.name}" vale numa unidade: escolha qual para o grupo.`,
        );
      }
      if (!role.scoped) m.orgUnitId = null;
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(ldapGroupMappings);
      if (body.mappings.length) {
        await tx
          .insert(ldapGroupMappings)
          .values(body.mappings.map((m) => ({ ...m, dn: m.dn.toLowerCase() })))
          .onConflictDoNothing();
      }
    });
    await this.audit.record({
      action: 'ldap.mappings_changed',
      actorId: req.auth!.user.id,
      entityType: 'ldap',
      ...clientInfo(req),
      metadata: { kind: 'group', count: body.mappings.length },
    });
    return { saved: body.mappings.length };
  }

  @Post('preview')
  @HttpCode(200)
  preview(): Promise<LdapPreview> {
    return this.directory(() => this.sync.preview());
  }

  @Post('sync')
  @HttpCode(200)
  run(
    @Body(new ZodPipe(runSyncSchema)) body: z.output<typeof runSyncSchema>,
    @Req() req: FastifyRequest,
  ): Promise<LdapSyncRun> {
    return this.sync.run({
      trigger: 'manual',
      actorId: req.auth!.user.id,
      confirmLargeChanges: body.confirmLargeChanges,
    });
  }

  @Get('runs')
  runs(): Promise<LdapSyncRun[]> {
    return this.sync.runs();
  }

  /** Falha de rede/certificado vira uma mensagem clara (503), não um erro interno. */
  private async directory<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DirectoryUnavailableError) {
        throw new AppException(503, 'DIRECTORY_UNAVAILABLE', e.message);
      }
      throw e;
    }
  }
}

/** "OU=DCA,OU=SEAD,DC=x" → "DC=x,OU=SEAD,OU=DCA": ordena pai antes dos filhos. */
function reversedDn(dn: string): string {
  return dn
    .toLowerCase()
    .split(/(?<!\\),/)
    .reverse()
    .join(',');
}
