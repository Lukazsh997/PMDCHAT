import { Inject, Injectable } from '@nestjs/common';
import {
  ROSTER_LIMITS,
  type RosterApplyResult,
  type rosterApplySchema,
  type RosterPersonChange,
  type RosterPlan,
  type rosterPlanSchema,
  type RosterSetor,
  type RosterStatus,
} from '@plataforma/contracts';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import {
  ldapSettings,
  orgUnits,
  roleAssignments,
  rosterEntries,
  rosterImports,
  users,
} from '../../database/schema/index.js';
import { UserPurgeService } from '../admin/index.js';
import { AuditService } from '../audit/index.js';
import { SessionService } from '../auth/index.js';
import { OrgService } from '../org/index.js';
import { LdapSettingsService } from './ldap-settings.service.js';
import { parseRoster, RosterParseError, type RosterRow } from './roster.parser.js';

type PlanInput = z.output<typeof rosterPlanSchema>;
type ApplyInput = z.output<typeof rosterApplySchema>;

/** Unidade já existente ou a criar (referência temporária "new:…"). */
type UnitRef = string;

interface NewUnit {
  ref: UnitRef;
  parent: UnitRef | null;
  kind: 'secretaria' | 'subsecretaria' | 'setor';
  name: string;
}

interface FullPlan {
  dto: RosterPlan;
  newUnits: NewUnit[];
  /** login → unidade (existente ou nova). */
  assignments: Map<string, { unit: UnitRef | null; displayName: string | null }>;
  moves: { userId: string; unit: UnitRef }[];
  removals: { id: string; username: string; displayName: string }[];
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const mostCommon = (m: Map<string, number>): string | null =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Importação da lista de lotação: monta secretarias e setores no organograma, lota
 * as pessoas e passa a usar a lista com o AD (quem é do AD e não está nela sai).
 * A prévia e a aplicação usam o mesmo cálculo; a prévia não grava nada.
 */
@Injectable()
export class RosterService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly org: OrgService,
    private readonly settings: LdapSettingsService,
    private readonly purger: UserPurgeService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async status(): Promise<RosterStatus> {
    const row = await this.settings.row();
    const [n] = await this.db.select({ n: count() }).from(rosterEntries);
    const [last] = await this.db
      .select({ imp: rosterImports, actorName: users.displayName })
      .from(rosterImports)
      .leftJoin(users, eq(users.id, rosterImports.actorId))
      .orderBy(desc(rosterImports.createdAt))
      .limit(1);
    return {
      active: row.orgUnitSource === 'roster',
      entries: n?.n ?? 0,
      lastImport: last
        ? {
            fileName: last.imp.fileName,
            at: last.imp.createdAt.toISOString(),
            actorName: last.actorName,
          }
        : null,
    };
  }

  /** Volta a lotação para as OUs do AD; a lista fica guardada, mas sem efeito. */
  async deactivate(actorId: string): Promise<RosterStatus> {
    await this.settings.row();
    await this.db
      .update(ldapSettings)
      .set({ orgUnitSource: 'ad', updatedBy: actorId })
      .where(eq(ldapSettings.id, 1));
    await this.audit.record({
      action: 'roster.deactivated',
      actorId,
      entityType: 'roster',
    });
    return this.status();
  }

  async preview(input: PlanInput, actorId: string): Promise<RosterPlan> {
    return (await this.plan(input, actorId)).dto;
  }

  async apply(input: ApplyInput, actorId: string): Promise<RosterApplyResult> {
    const plan = await this.plan(input, actorId);
    if (plan.dto.removal.needsConfirmation && !input.confirmLargeRemoval) {
      throw new AppException(
        409,
        'CONFLICT',
        `A importação removeria ${plan.dto.removal.count} contas do AD. Confira a prévia e confirme.`,
      );
    }

    // 1. Unidades novas: secretarias antes dos setores (a lista já vem nessa ordem).
    const created = new Map<UnitRef, string>();
    const resolve = (ref: UnitRef | null): string | null =>
      ref === null ? null : ref.startsWith('new:') ? (created.get(ref) ?? null) : ref;
    for (const u of plan.newUnits) {
      const row = await this.org.create({
        parentId: resolve(u.parent),
        kind: u.kind,
        name: u.name,
      });
      created.set(u.ref, row.id);
    }

    // 2. A lista passa a valer (substitui a anterior inteira).
    const entries = [...plan.assignments.entries()].map(([username, a]) => ({
      username,
      displayName: a.displayName,
      orgUnitId: resolve(a.unit),
    }));
    const summary = {
      rows: plan.dto.rows,
      people: entries.length,
      unitsCreated: plan.newUnits.length,
      moved: plan.moves.length,
      removed: plan.removals.length,
    };
    await this.settings.row(); // garante a linha de configuração (id = 1)
    await this.db.transaction(async (tx) => {
      await tx.delete(rosterEntries);
      const [imp] = await tx
        .insert(rosterImports)
        .values({ fileName: input.fileName, actorId, summary })
        .returning({ id: rosterImports.id });
      for (let i = 0; i < entries.length; i += 1000) {
        await tx
          .insert(rosterEntries)
          .values(entries.slice(i, i + 1000).map((e) => ({ ...e, importId: imp!.id })));
      }
      await tx
        .update(ldapSettings)
        .set({ orgUnitSource: 'roster', updatedBy: actorId })
        .where(eq(ldapSettings.id, 1));
    });

    // 3. Lotação de quem já tem conta.
    const byUnit = new Map<string, string[]>();
    for (const m of plan.moves) {
      const unit = resolve(m.unit);
      if (unit) byUnit.set(unit, [...(byUnit.get(unit) ?? []), m.userId]);
    }
    for (const [unit, ids] of byUnit) {
      await this.db.update(users).set({ orgUnitId: unit }).where(inArray(users.id, ids));
      for (const id of ids) this.events.emit('user.membership_changed', { userId: id });
    }

    // 4. Quem é do AD e não está na lista.
    for (const r of plan.removals) {
      if (input.removal === 'delete') {
        await this.purger.purge(r.id);
      } else {
        await this.db
          .update(users)
          .set({ status: 'disabled', ldapDisabledAt: new Date() })
          .where(eq(users.id, r.id));
        await this.sessions.revokeAllForUser(r.id, 'user_disabled');
        this.events.emit('user.membership_changed', { userId: r.id });
      }
      await this.audit.record({
        action: input.removal === 'delete' ? 'user.deleted' : 'user.status_changed',
        actorId,
        entityType: 'user',
        entityId: r.id,
        metadata: {
          username: r.username,
          displayName: r.displayName,
          via: 'roster',
          ...(input.removal === 'disable' ? { status: 'disabled' } : {}),
        },
      });
    }

    if (plan.newUnits.length) this.events.emit('org.changed', {});
    await this.audit.record({
      action: 'roster.imported',
      actorId,
      entityType: 'roster',
      metadata: { fileName: input.fileName, removal: input.removal, ...summary },
    });
    return {
      created: plan.newUnits.length,
      moved: plan.moves.length,
      removed: plan.removals.length,
      entries: entries.length,
    };
  }

  /* --------------------------------- Cálculo -------------------------------- */

  private async plan(input: PlanInput, actorId: string): Promise<FullPlan> {
    let parsed: ReturnType<typeof parseRoster>;
    try {
      parsed = parseRoster(input.content);
    } catch (e) {
      if (e instanceof RosterParseError)
        throw new AppException(400, 'VALIDATION_FAILED', e.message);
      throw e;
    }
    const problems = [...parsed.problems];
    const units = await this.db.select().from(orgUnits);
    const unitById = new Map(units.map((u) => [u.id, u]));

    // Uma linha por login: se repetir, vale a primeira.
    const people = new Map<string, RosterRow>();
    for (const r of parsed.rows) {
      const first = people.get(r.username);
      if (first) {
        if ((first.setorId ?? first.setor) !== (r.setorId ?? r.setor)) {
          problems.push(
            `Login ${r.username} aparece mais de uma vez (linhas ${first.line} e ${r.line}); vale a linha ${first.line}.`,
          );
        }
        continue;
      }
      people.set(r.username, r);
    }

    // Setores: pelo código quando houver; sem código, pelo nome.
    interface Agg {
      key: string;
      names: Map<string, number>;
      secretarias: Map<string, number>;
      people: string[];
    }
    const setores = new Map<string, Agg>();
    const nameToIdKeys = new Map<string, Set<string>>();
    for (const r of people.values()) {
      if (r.setorId && r.setor) {
        const k = `id:${r.setorId}`;
        nameToIdKeys.set(norm(r.setor), (nameToIdKeys.get(norm(r.setor)) ?? new Set()).add(k));
      }
    }
    const noSector: string[] = [];
    for (const r of people.values()) {
      let key: string;
      if (r.setorId) key = `id:${r.setorId}`;
      else if (r.setor) {
        const ids = nameToIdKeys.get(norm(r.setor));
        key = ids?.size === 1 ? [...ids][0]! : `nome:${norm(r.secretaria ?? '')}|${norm(r.setor)}`;
      } else {
        noSector.push(r.username);
        continue;
      }
      let a = setores.get(key);
      if (!a) setores.set(key, (a = { key, names: new Map(), secretarias: new Map(), people: [] }));
      if (r.setor) bump(a.names, r.setor);
      if (r.secretaria) bump(a.secretarias, r.secretaria);
      a.people.push(r.username);
    }
    if (noSector.length) {
      problems.push(
        `${noSector.length} ${noSector.length === 1 ? 'pessoa sem setor ficou' : 'pessoas sem setor ficaram'} fora da lista: ${noSector.slice(0, 10).join(', ')}${noSector.length > 10 ? '…' : ''}.`,
      );
      for (const u of noSector) people.delete(u);
    }

    // Secretarias do arquivo e o que cada uma vira.
    const rawCount = new Map<string, number>();
    for (const r of people.values()) if (r.secretaria) bump(rawCount, r.secretaria);
    const rawNames = [...rawCount.keys()];
    // "Secretaria Municipal de Administração" também responde por "ADMINISTRAÇÃO".
    const bare = (s: string) =>
      norm(s).replace(/^(secretaria|subsecretaria)( municipal)?( (de|da|do|das|dos))? /, '');
    const suggestion = (raw: string): string => {
      const n = norm(raw);
      const hits = units
        .filter(
          (u) =>
            u.isActive &&
            (norm(u.name) === n ||
              (u.acronym && norm(u.acronym) === n) ||
              (u.kind === 'secretaria' && bare(u.name) === bare(raw))),
        )
        .sort(
          (a, b) =>
            Number(b.kind === 'secretaria') - Number(a.kind === 'secretaria') || a.depth - b.depth,
        );
      return hits[0] ? `existing:${hits[0].id}` : 'create';
    };
    const decisionOf = (raw: string): string => {
      const d = input.secretarias[raw];
      if (!d) return suggestion(raw);
      if (d.startsWith('existing:') && !unitById.has(d.slice(9))) return suggestion(raw);
      if (d.startsWith('alias:') && !rawCount.has(d.slice(6))) return suggestion(raw);
      return d;
    };

    // Onde criar as secretarias novas: o escolhido, ou a única raiz do organograma.
    const roots = units.filter((u) => !u.parentId && u.isActive);
    let parentId: string | null =
      input.parentId !== undefined ? input.parentId : roots.length === 1 ? roots[0]!.id : null;
    if (parentId && !unitById.has(parentId)) parentId = null;

    const newUnits: NewUnit[] = [];
    const newByParentName = new Map<string, NewUnit>();
    const childOf = (parent: UnitRef | null, name: string): UnitRef | null => {
      const n = norm(name);
      if (parent === null || !parent.startsWith('new:')) {
        const hit = units.find(
          (u) =>
            (u.parentId ?? null) === parent &&
            (norm(u.name) === n || (!!u.acronym && norm(u.acronym) === n)),
        );
        if (hit) return hit.id;
      }
      return newByParentName.get(`${parent}|${n}`)?.ref ?? null;
    };
    const addUnit = (parent: UnitRef | null, name: string, kind: NewUnit['kind']): UnitRef => {
      const found = childOf(parent, name);
      if (found) return found;
      const u: NewUnit = {
        ref: `new:${newUnits.length}`,
        parent,
        kind,
        name: name.slice(0, 160),
      };
      newUnits.push(u);
      newByParentName.set(`${parent}|${norm(name)}`, u);
      return u.ref;
    };

    // Resolve apelidos (FAZENDA → SMF) e cria as secretarias que faltam.
    const secUnit = new Map<string, UnitRef>();
    const resolveSec = (raw: string, depth = 0): UnitRef => {
      const done = secUnit.get(raw);
      if (done) return done;
      const d = decisionOf(raw);
      let ref: UnitRef;
      if (d.startsWith('existing:')) ref = d.slice(9);
      else if (d.startsWith('alias:') && depth < 10 && d.slice(6) !== raw) {
        ref = resolveSec(d.slice(6), depth + 1);
      } else ref = addUnit(parentId, raw, 'secretaria');
      secUnit.set(raw, ref);
      return ref;
    };
    for (const raw of [...rawNames].sort((a, b) => a.localeCompare(b, 'pt-BR'))) resolveSec(raw);

    const label = (ref: UnitRef | null): string | null => {
      if (!ref) return null;
      if (ref.startsWith('new:')) {
        const u = newUnits.find((x) => x.ref === ref)!;
        return `${u.name} (nova)`;
      }
      const u = unitById.get(ref);
      return u ? u.acronym || u.name : null;
    };

    // Setores dentro das secretarias.
    const setorDtos: RosterSetor[] = [];
    const setorUnit = new Map<string, UnitRef | null>();
    for (const a of [...setores.values()].sort((x, y) =>
      (mostCommon(x.names) ?? '').localeCompare(mostCommon(y.names) ?? '', 'pt-BR'),
    )) {
      const name = mostCommon(a.names) ?? a.key;
      const chosenRaw = input.setores[a.key];
      const secretaria =
        chosenRaw && rawCount.has(chosenRaw) ? chosenRaw : mostCommon(a.secretarias);
      const parent = secretaria ? resolveSec(secretaria) : parentId;
      const before = newUnits.length;
      const kind = /^sub(secretaria)?\b/i.test(norm(name)) ? 'subsecretaria' : 'setor';
      const ref = addUnit(parent, name, kind);
      setorUnit.set(a.key, ref);
      setorDtos.push({
        key: a.key,
        name,
        secretaria,
        // Nomes que vão para a mesma unidade (ex.: FAZENDA = SMF) não são conflito.
        alternatives: [...a.secretarias.entries()]
          .filter(([s]) => s !== secretaria && resolveSec(s) !== parent)
          .map(([s, n]) => ({ secretaria: s, people: n }))
          .sort((x, y) => y.people - x.people),
        people: a.people.length,
        unitId: ref.startsWith('new:') ? null : ref,
        isNew: newUnits.length > before || ref.startsWith('new:'),
      });
    }

    // Pessoas: quem já tem conta muda de lotação; quem não tem entra depois, pelo AD.
    const usernames = [...people.keys()];
    const accounts = usernames.length
      ? await this.db
          .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            orgUnitId: users.orgUnitId,
          })
          .from(users)
          .where(and(isNull(users.deletedAt), inArray(users.username, usernames)))
      : [];
    const accountBy = new Map(accounts.map((a) => [a.username, a]));
    const assignments: FullPlan['assignments'] = new Map();
    const moves: FullPlan['moves'] = [];
    const changes: RosterPersonChange[] = [];
    let unchanged = 0;
    let withoutAccount = 0;
    for (const a of setores.values()) {
      const unit = setorUnit.get(a.key) ?? null;
      for (const username of a.people) {
        const row = people.get(username)!;
        assignments.set(username, { unit, displayName: row.displayName });
        const acc = accountBy.get(username);
        if (!acc) {
          withoutAccount++;
          continue;
        }
        if (unit && acc.orgUnitId === unit) {
          unchanged++;
          continue;
        }
        if (!unit) continue;
        moves.push({ userId: acc.id, unit });
        changes.push({
          username,
          displayName: acc.displayName,
          from: acc.orgUnitId ? label(acc.orgUnitId) : null,
          to: label(unit),
        });
      }
    }
    changes.sort((x, y) => x.displayName.localeCompare(y.displayName, 'pt-BR'));

    // Contas do AD fora da lista. O super administrador local e quem importa nunca saem.
    const ldapUsers = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        status: users.status,
      })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.authSource, 'ldap')));
    const supers = new Set(
      (
        await this.db
          .select({ userId: roleAssignments.userId })
          .from(roleAssignments)
          .where(eq(roleAssignments.role, 'super_admin'))
      ).map((r) => r.userId),
    );
    const removals = ldapUsers
      .filter(
        (u) =>
          !people.has(u.username) &&
          !supers.has(u.id) &&
          u.id !== actorId &&
          (input.removal === 'delete' || u.status === 'active'),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
    const needsConfirmation =
      removals.length > 5 && removals.length > ldapUsers.length * ROSTER_LIMITS.maxRemoveFraction;

    const secretariaDtos = rawNames
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((raw) => {
        const decision = decisionOf(raw);
        const ref = secUnit.get(raw)!;
        const target = decision.startsWith('alias:')
          ? `mesma que ${decision.slice(6)} → ${label(ref) ?? '?'}`
          : (label(ref) ?? '?');
        return { raw, people: rawCount.get(raw) ?? 0, decision, target };
      });

    return {
      dto: {
        fileName: input.fileName,
        format: parsed.format,
        rows: parsed.rows.length,
        parentId,
        secretarias: secretariaDtos,
        setores: setorDtos,
        unitsToCreate: newUnits.length,
        people: {
          total: assignments.size,
          moved: moves.length,
          unchanged,
          withoutAccount,
          changes: changes.slice(0, ROSTER_LIMITS.maxListed),
        },
        removal: {
          mode: input.removal,
          count: removals.length,
          people: removals
            .slice(0, ROSTER_LIMITS.maxListed)
            .map((r) => ({ username: r.username, displayName: r.displayName })),
          needsConfirmation,
        },
        problems: problems.slice(0, 200),
      },
      newUnits,
      assignments,
      moves,
      removals,
    };
  }
}
