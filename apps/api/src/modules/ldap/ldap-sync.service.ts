import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LDAP_DEFAULTS,
  type LdapChange,
  type LdapPreview,
  type LdapSyncRun,
  type LdapSyncSummary,
} from '@plataforma/contracts';
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import {
  ldapGroupMappings,
  ldapOuMappings,
  ldapSettings,
  ldapSyncRuns,
  rosterEntries,
  orgUnits,
  roleAssignments,
  roles,
  userCredentials,
  type UserRow,
  users,
} from '../../database/schema/index.js';
import { REDIS } from '../../redis/redis.module.js';
import { AuditService } from '../audit/index.js';
import { SessionService } from '../auth/index.js';
import { type DirectoryPerson, normalizeDn, parentDn } from './ldap.gateway.js';
import { LdapSettingsService } from './ldap-settings.service.js';

/** Contas do AD não têm senha local: o login confere a senha no próprio AD. */
export const LDAP_PASSWORD_MARKER = '!ldap';
const LOCK_KEY = 'ldap:sync:lock';
const MAX_PREVIEW_CHANGES = 300;

type SettingsRow = typeof ldapSettings.$inferSelect;

interface Desired {
  username: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  orgUnitId: string | null;
}

interface PlannedUser {
  person: DirectoryPerson;
  /** null = conta nova. */
  existing: UserRow | null;
  set: Partial<UserRow>;
  disable: boolean;
  reenable: boolean;
  rolesAdd: { role: string; orgUnitId: string | null }[];
  rolesRemove: string[];
  change: LdapChange | null;
}

interface Plan {
  users: PlannedUser[];
  /** Contas do AD que sumiram da busca (apagadas ou fora da OU): desativar. */
  missing: UserRow[];
  summary: LdapSyncSummary;
  changes: LdapChange[];
}

/**
 * Sincronização com o AD: compara a busca do AD com o sistema e aplica as diferenças
 * (pessoas novas, nome, e-mail, cargo, lotação pela OU, papéis pelos grupos, desativação).
 * A mesma comparação gera a pré-visualização no painel, sem gravar nada.
 */
@Injectable()
export class LdapSyncService {
  private readonly logger = new Logger(LdapSyncService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: LdapSettingsService,
    private readonly sessions: SessionService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  async preview(): Promise<LdapPreview> {
    const { row, gateway } = await this.settings.requireGateway();
    const { people, skipped } = await gateway.listPeople();
    const plan = await this.plan(people, row, true);
    if (skipped) plan.summary.problems.unshift(skippedNote(skipped));
    return {
      ...plan.summary,
      changes: plan.changes.slice(0, MAX_PREVIEW_CHANGES),
      truncated: plan.changes.length > MAX_PREVIEW_CHANGES,
    };
  }

  /**
   * Sincroniza de verdade. Se for desativar gente demais (sinal de busca errada no AD),
   * para sem gravar e registra "bloqueada", a menos que alguém confirme no painel.
   */
  async run(opts: {
    trigger: 'manual' | 'schedule';
    actorId: string | null;
    confirmLargeChanges?: boolean;
  }): Promise<LdapSyncRun> {
    const lock = await this.redis.set(LOCK_KEY, '1', 'EX', 30 * 60, 'NX');
    if (!lock) {
      throw new AppException(409, 'CONFLICT', 'Já há uma sincronização em andamento.');
    }
    const id = uuidv7();
    await this.db
      .insert(ldapSyncRuns)
      .values({ id, trigger: opts.trigger, status: 'running', actorId: opts.actorId });
    try {
      const { row, gateway } = await this.settings.requireGateway();
      const { people, skipped } = await gateway.listPeople();
      const plan = await this.plan(people, row, true);
      if (skipped) plan.summary.problems.unshift(skippedNote(skipped));
      if (plan.summary.needsConfirmation && !opts.confirmLargeChanges) {
        await this.finish(id, 'blocked', plan.summary, null);
        return this.getRun(id);
      }
      await this.apply(plan, opts.actorId);
      await this.finish(id, 'success', plan.summary, null);
      await this.audit.record({
        action: 'ldap.sync',
        actorId: opts.actorId,
        entityType: 'ldap_sync',
        entityId: id,
        metadata: { trigger: opts.trigger, ...countsOf(plan.summary) },
      });
      return this.getRun(id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Sincronização com o AD falhou: ${message}`);
      await this.finish(id, 'failed', null, message);
      if (opts.trigger === 'manual' && e instanceof AppException) throw e;
      return this.getRun(id);
    } finally {
      await this.redis.del(LOCK_KEY);
    }
  }

  /**
   * Login de quem entrou com a senha do AD: cria ou atualiza só esta pessoa (sem mexer
   * nas outras). Devolve null se ela não pode entrar (desativada, ou sem cadastro e sem
   * criação automática).
   */
  async provisionOnLogin(person: DirectoryPerson, row: SettingsRow): Promise<UserRow | null> {
    if (person.disabled) return null;
    const plan = await this.plan([person], row, false);
    const p = plan.users[0];
    if (!p) return null;
    if (!p.existing && !row.autoProvision) return null;
    await this.apply(plan, null);
    const [u] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.externalId, person.guid), isNull(users.deletedAt)))
      .limit(1);
    return u ?? null;
  }

  async runs(limit = 20): Promise<LdapSyncRun[]> {
    const rows = await this.db
      .select({ run: ldapSyncRuns, actorName: users.displayName })
      .from(ldapSyncRuns)
      .leftJoin(users, eq(users.id, ldapSyncRuns.actorId))
      .orderBy(desc(ldapSyncRuns.startedAt))
      .limit(limit);
    return rows.map((r) => toRunDto(r.run, r.actorName));
  }

  /** Hora da última sincronização que terminou (para a agenda automática). */
  async lastFinishedAt(): Promise<Date | null> {
    const [r] = await this.db
      .select({ at: ldapSyncRuns.finishedAt })
      .from(ldapSyncRuns)
      .where(isNotNull(ldapSyncRuns.finishedAt))
      .orderBy(desc(ldapSyncRuns.finishedAt))
      .limit(1);
    return r?.at ?? null;
  }

  /* ------------------------------- Comparação ------------------------------ */

  /**
   * @param complete a lista é o AD inteiro (sincronização): quem não veio é desativado.
   *   No login vem só uma pessoa, e ninguém mais é tocado.
   */
  private async plan(
    people: DirectoryPerson[],
    row: SettingsRow,
    complete: boolean,
  ): Promise<Plan> {
    const [ouMaps, groupMaps, units, ldapRoles, superAdmins] = await Promise.all([
      this.db.select().from(ldapOuMappings),
      this.db.select().from(ldapGroupMappings),
      this.db
        .select({ id: orgUnits.id, name: orgUnits.name, acronym: orgUnits.acronym })
        .from(orgUnits),
      this.db.select({ key: roles.key, name: roles.name }).from(roles),
      this.db
        .select({ userId: roleAssignments.userId })
        .from(roleAssignments)
        .where(and(eq(roleAssignments.role, 'super_admin'), eq(roleAssignments.source, 'manual'))),
    ]);
    const unitName = new Map(units.map((u) => [u.id, u.acronym || u.name]));
    const roleName = new Map(ldapRoles.map((r) => [r.key, r.name]));
    const protectedIds = new Set(superAdmins.map((s) => s.userId));
    const ouMap = new Map(ouMaps.map((m) => [normalizeDn(m.dn), m.orgUnitId]));
    // Com a lista de lotação ativa, ela diz o setor de cada um e quem pode ter conta.
    const roster =
      row.orgUnitSource === 'roster'
        ? new Map(
            (
              await this.db
                .select({ username: rosterEntries.username, orgUnitId: rosterEntries.orgUnitId })
                .from(rosterEntries)
            ).map((r) => [r.username, r.orgUnitId]),
          )
        : null;

    // Candidatos no sistema: contas já ligadas ao AD e contas locais com o mesmo login.
    const usernames = people.map((p) => p.username);
    const guids = people.map((p) => p.guid);
    const candidates = await this.db
      .select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          or(
            eq(users.authSource, 'ldap'),
            guids.length ? inArray(users.externalId, guids) : sql`false`,
            usernames.length ? inArray(users.username, usernames) : sql`false`,
          ),
        ),
      );
    const byGuid = new Map(candidates.filter((u) => u.externalId).map((u) => [u.externalId!, u]));
    const byUsername = new Map(candidates.map((u) => [u.username, u]));

    // Quem já usa cada e-mail e login (para não criar conflitos).
    const taken = await this.db
      .select({ id: users.id, username: users.username, email: users.email })
      .from(users);
    const emailOwner = new Map(
      taken.filter((t) => t.email).map((t) => [t.email!.toLowerCase(), t.id]),
    );
    const usernameOwner = new Map(taken.map((t) => [t.username, t.id]));

    const existingIds = candidates.map((u) => u.id);
    const currentLdapRoles = existingIds.length
      ? await this.db
          .select()
          .from(roleAssignments)
          .where(
            and(inArray(roleAssignments.userId, existingIds), eq(roleAssignments.source, 'ldap')),
          )
      : [];

    const resolveUnit = (p: DirectoryPerson, current: string | null): string | null => {
      if (roster) return roster.get(p.username) ?? current;
      const dn = p.dn;
      // A OU mais específica com mapeamento vence: "OU=DCA,OU=SEAD" antes de "OU=SEAD".
      for (let d = parentDn(dn); d; d = parentDn(d)) {
        const hit = ouMap.get(d);
        if (hit) return hit;
      }
      return row.defaultOrgUnitId ?? current;
    };
    const desiredRoles = (p: DirectoryPerson) => {
      const out = new Map<string, { role: string; orgUnitId: string | null }>();
      for (const m of groupMaps) {
        if (!p.groups.includes(normalizeDn(m.dn))) continue;
        // Super administrador nunca vem de grupo do AD: só é dado à mão, no painel.
        if (m.role === 'super_admin') continue;
        out.set(`${m.role}|${m.orgUnitId ?? ''}`, { role: m.role, orgUnitId: m.orgUnitId });
      }
      return out;
    };

    const summary: LdapSyncSummary = {
      created: 0,
      updated: 0,
      disabled: 0,
      reenabled: 0,
      roleChanges: 0,
      unchanged: 0,
      problems: [],
      needsConfirmation: false,
    };
    const changes: LdapChange[] = [];
    const planned: PlannedUser[] = [];
    const seen = new Set<string>();

    for (const p of people) {
      let existing = byGuid.get(p.guid) ?? null;
      if (!existing) {
        const same = byUsername.get(p.username);
        // Conta local com o mesmo login passa a entrar pelo AD — menos o super
        // administrador local, que fica como acesso de emergência.
        if (same && !same.externalId && !protectedIds.has(same.id)) existing = same;
      }
      if (existing) seen.add(existing.id);

      const outside = !!roster && !roster.has(p.username);
      if (outside && (!existing || existing.authSource !== 'ldap')) {
        // Fora da lista: não ganha conta (e uma conta local com o mesmo login fica como está).
        if (!existing) summary.outsideRoster = (summary.outsideRoster ?? 0) + 1;
        continue;
      }

      const want: Desired = {
        username: p.username,
        displayName: p.displayName,
        email: p.email,
        jobTitle: p.jobTitle,
        orgUnitId: resolveUnit(p, existing?.orgUnitId ?? null),
      };
      const emailOwnerId = want.email ? emailOwner.get(want.email.toLowerCase()) : undefined;
      if (emailOwnerId && emailOwnerId !== existing?.id) {
        summary.problems.push(
          `${p.username}: o e-mail ${want.email} já é usado por outra conta; ficou sem e-mail.`,
        );
        want.email = existing?.email ?? null;
      }
      const usernameOwnerId = usernameOwner.get(want.username);
      if (usernameOwnerId && usernameOwnerId !== existing?.id) {
        summary.problems.push(
          existing
            ? `${p.username}: o login novo já pertence a outra conta; o login atual foi mantido.`
            : `${p.username}: o login já pertence a uma conta local protegida; não foi importado.`,
        );
        if (!existing) continue;
        want.username = existing.username;
      }

      const wantRoles = desiredRoles(p);
      const haveRoles = currentLdapRoles.filter((a) => a.userId === existing?.id);
      const rolesAdd = [...wantRoles.entries()]
        .filter(([k]) => !haveRoles.some((h) => `${h.role}|${h.orgUnitId ?? ''}` === k))
        .map(([, v]) => v);
      const rolesRemove = haveRoles
        .filter((h) => !wantRoles.has(`${h.role}|${h.orgUnitId ?? ''}`))
        .map((h) => h.id);
      const roleText = (r: { role: string; orgUnitId: string | null }) =>
        `${roleName.get(r.role) ?? r.role}${r.orgUnitId ? ` (${unitName.get(r.orgUnitId) ?? '?'})` : ''}`;
      const roleDetails = [
        ...rolesAdd.map((r) => `papel + ${roleText(r)}`),
        ...haveRoles.filter((h) => rolesRemove.includes(h.id)).map((h) => `papel − ${roleText(h)}`),
      ];

      if (!existing) {
        if (p.disabled || !row.autoProvision) continue;
        summary.created++;
        if (rolesAdd.length) summary.roleChanges += rolesAdd.length;
        const change: LdapChange = {
          kind: 'create',
          username: want.username,
          displayName: want.displayName,
          details: [
            want.orgUnitId ? `lotação: ${unitName.get(want.orgUnitId) ?? '?'}` : 'sem lotação',
            ...roleDetails,
          ],
        };
        changes.push(change);
        planned.push({
          person: p,
          existing: null,
          set: { ...want },
          disable: false,
          reenable: false,
          rolesAdd,
          rolesRemove: [],
          change,
        });
        continue;
      }

      const set: Partial<UserRow> = {};
      const details: string[] = [];
      const diff = <K extends keyof Desired>(key: K, label: string, show = true) => {
        if ((existing![key] ?? null) === (want[key] ?? null)) return;
        (set as Record<string, unknown>)[key] = want[key];
        if (!show) return details.push(label);
        const from = key === 'orgUnitId' ? unitName.get(existing![key] as string) : existing![key];
        const to = key === 'orgUnitId' ? unitName.get(want[key] as string) : want[key];
        details.push(`${label}: ${from ?? '—'} → ${to ?? '—'}`);
      };
      diff('username', 'login');
      diff('displayName', 'nome');
      diff('email', 'e-mail');
      diff('jobTitle', 'cargo');
      diff('orgUnitId', 'lotação');
      if (existing.authSource !== 'ldap' || existing.externalId !== p.guid) {
        set.authSource = 'ldap';
        set.externalId = p.guid;
        details.push('passa a entrar com a senha do AD');
      }
      if (existing.ldapDn !== p.dn) set.ldapDn = p.dn;

      const disable = (p.disabled || outside) && existing.status === 'active';
      const reenable =
        !p.disabled && !outside && existing.status === 'disabled' && !!existing.ldapDisabledAt;
      if (disable) {
        set.status = 'disabled';
        set.ldapDisabledAt = new Date();
      }
      if (reenable) {
        set.status = 'active';
        set.ldapDisabledAt = null;
      }

      const visible = details.length > 0 || roleDetails.length > 0 || disable || reenable;
      if (disable) summary.disabled++;
      else if (reenable) summary.reenabled++;
      else if (details.length) summary.updated++;
      summary.roleChanges += rolesAdd.length + rolesRemove.length;
      if (!visible) summary.unchanged++;

      const change: LdapChange | null = visible
        ? {
            kind: disable ? 'disable' : reenable ? 'reenable' : details.length ? 'update' : 'roles',
            username: existing.username,
            displayName: want.displayName,
            details: [
              ...(disable
                ? [outside && !p.disabled ? 'fora da lista de lotação' : 'desativada no AD']
                : reenable
                  ? ['reativada']
                  : []),
              ...details,
              ...roleDetails,
            ],
          }
        : null;
      if (change) changes.push(change);
      planned.push({
        person: p,
        existing,
        set,
        disable,
        reenable,
        rolesAdd,
        rolesRemove,
        change,
      });
    }

    const missing = complete
      ? candidates.filter(
          (u) => u.authSource === 'ldap' && !seen.has(u.id) && u.status === 'active',
        )
      : [];
    for (const u of missing) {
      summary.disabled++;
      changes.push({
        kind: 'disable',
        username: u.username,
        displayName: u.displayName,
        details: ['não aparece mais no AD (apagada ou fora da busca)'],
      });
    }

    if (complete) {
      const activeLdap = candidates.filter(
        (u) => u.authSource === 'ldap' && u.status === 'active',
      ).length;
      const disabling = summary.disabled;
      summary.needsConfirmation =
        (people.length === 0 && activeLdap > 0) ||
        (disabling > 5 && disabling > activeLdap * LDAP_DEFAULTS.maxDisableFraction);
    }
    // Ordem para leitura: o que exige atenção primeiro.
    const order = { disable: 0, create: 1, reenable: 2, update: 3, roles: 4 } as const;
    changes.sort(
      (a, b) =>
        order[a.kind] - order[b.kind] || a.displayName.localeCompare(b.displayName, 'pt-BR'),
    );
    return { users: planned, missing, summary, changes };
  }

  /* -------------------------------- Aplicação ------------------------------- */

  private async apply(plan: Plan, actorId: string | null): Promise<void> {
    const membershipChanged = new Set<string>();
    const revoke: { id: string; reason: string }[] = [];

    for (const p of plan.users) {
      if (!p.existing) {
        const id = uuidv7();
        await this.db.transaction(async (tx) => {
          await tx.insert(users).values({
            id,
            username: p.set.username!,
            displayName: p.set.displayName!,
            email: p.set.email ?? null,
            jobTitle: p.set.jobTitle ?? null,
            orgUnitId: p.set.orgUnitId ?? null,
            authSource: 'ldap',
            externalId: p.person.guid,
            ldapDn: p.person.dn,
          });
          await tx
            .insert(userCredentials)
            .values({ userId: id, passwordHash: LDAP_PASSWORD_MARKER });
          if (p.rolesAdd.length) {
            await tx
              .insert(roleAssignments)
              .values(p.rolesAdd.map((r) => ({ ...r, userId: id, source: 'ldap' })))
              .onConflictDoNothing();
          }
        });
        membershipChanged.add(id);
        await this.audit.record({
          action: 'user.created',
          actorId,
          entityType: 'user',
          entityId: id,
          metadata: { username: p.set.username, via: 'ldap' },
        });
        continue;
      }

      const userId = p.existing.id;
      if (Object.keys(p.set).length || p.rolesAdd.length || p.rolesRemove.length) {
        await this.db.transaction(async (tx) => {
          if (Object.keys(p.set).length) {
            await tx.update(users).set(p.set).where(eq(users.id, userId));
          }
          if (p.set.authSource === 'ldap') {
            // A senha local deixa de valer: a partir de agora, só a do AD.
            await tx
              .update(userCredentials)
              .set({ passwordHash: LDAP_PASSWORD_MARKER })
              .where(eq(userCredentials.userId, userId));
          }
          if (p.rolesRemove.length) {
            await tx.delete(roleAssignments).where(inArray(roleAssignments.id, p.rolesRemove));
          }
          if (p.rolesAdd.length) {
            await tx
              .insert(roleAssignments)
              .values(p.rolesAdd.map((r) => ({ ...r, userId, source: 'ldap' })))
              .onConflictDoNothing();
          }
        });
      }
      if ('orgUnitId' in p.set || p.disable || p.reenable) membershipChanged.add(userId);
      if (p.disable) revoke.push({ id: userId, reason: 'ldap_disabled' });
      if (p.disable || p.reenable) {
        await this.audit.record({
          action: 'user.status_changed',
          actorId,
          entityType: 'user',
          entityId: userId,
          metadata: {
            from: p.existing.status,
            to: p.disable ? 'disabled' : 'active',
            via: 'ldap',
          },
        });
      }
    }

    for (const u of plan.missing) {
      await this.db
        .update(users)
        .set({ status: 'disabled', ldapDisabledAt: new Date() })
        .where(eq(users.id, u.id));
      revoke.push({ id: u.id, reason: 'ldap_removed' });
      membershipChanged.add(u.id);
      await this.audit.record({
        action: 'user.status_changed',
        actorId,
        entityType: 'user',
        entityId: u.id,
        metadata: { from: u.status, to: 'disabled', via: 'ldap', reason: 'not_in_directory' },
      });
    }

    for (const r of revoke) await this.sessions.revokeAllForUser(r.id, r.reason);
    // Canais ligados a unidades acompanham a nova lotação.
    for (const userId of membershipChanged) {
      this.events.emit('user.membership_changed', { userId });
    }
  }

  private async finish(
    id: string,
    status: LdapSyncRun['status'],
    summary: LdapSyncSummary | null,
    error: string | null,
  ): Promise<void> {
    await this.db
      .update(ldapSyncRuns)
      .set({ status, summary, error, finishedAt: new Date() })
      .where(eq(ldapSyncRuns.id, id));
  }

  private async getRun(id: string): Promise<LdapSyncRun> {
    const [r] = await this.db
      .select({ run: ldapSyncRuns, actorName: users.displayName })
      .from(ldapSyncRuns)
      .leftJoin(users, eq(users.id, ldapSyncRuns.actorId))
      .where(eq(ldapSyncRuns.id, id));
    return toRunDto(r!.run, r!.actorName);
  }
}

function toRunDto(r: typeof ldapSyncRuns.$inferSelect, actorName: string | null): LdapSyncRun {
  return {
    id: r.id,
    trigger: r.trigger as LdapSyncRun['trigger'],
    status: r.status as LdapSyncRun['status'],
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    summary: r.summary ?? null,
    error: r.error,
    actorName,
  };
}

const countsOf = (s: LdapSyncSummary) => ({
  created: s.created,
  updated: s.updated,
  disabled: s.disabled,
  reenabled: s.reenabled,
  roleChanges: s.roleChanges,
  problems: s.problems.length,
});

const skippedNote = (n: number) =>
  `${n} ${n === 1 ? 'conta do AD foi ignorada' : 'contas do AD foram ignoradas'}: login fora do padrão (só letras minúsculas, números, ponto, hífen e sublinhado) ou sem objectGUID.`;
