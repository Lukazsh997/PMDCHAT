import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminUser,
  type AdminUserList,
  type AssignRoleRequest,
  type RoleAssignment,
  type UpdateUserRequest,
  type UserStatus,
  createUserSchema,
} from '@plataforma/contracts';
import { and, count, desc, eq, ilike, inArray, isNull, like, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import {
  orgUnits,
  type OrgUnitRow,
  roleAssignments,
  roles,
  userCredentials,
  type UserRow,
  users,
} from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import { RolesService } from './roles.service.js';
import { PasswordService, SessionService } from '../auth/index.js';
import { OrgService } from '../org/index.js';
import { type Grants, rolePermissions } from '../rbac/index.js';
import { AvatarService, unitRef, UsersService } from '../users/index.js';

type CreateInput = z.output<typeof createUserSchema>;
interface Actor {
  id: string;
  grants: Grants;
  ip: string | null;
  userAgent: string | null;
}

export interface ListFilter {
  q?: string;
  orgUnitId?: string;
  status?: UserStatus;
  page: number;
  pageSize: number;
}

/**
 * Gestão de usuários pelo painel. Toda operação confere o escopo: um administrador
 * de unidade só enxerga e altera pessoas lotadas na sua unidade ou abaixo dela.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly org: OrgService,
    private readonly audit: AuditService,
    private readonly avatars: AvatarService,
    private readonly events: DomainEvents,
    private readonly roles: RolesService,
  ) {}

  /** Lotação ou situação mudou: canais de unidade se ajustam. */
  private changed(userId: string): void {
    this.events.emit('user.membership_changed', { userId });
  }

  async list(actor: Actor, f: ListFilter): Promise<AdminUserList> {
    const conditions: SQL[] = [isNull(users.deletedAt)];
    const scope = actor.grants.scopePaths('users.read');
    if (scope) {
      if (!scope.length) return { items: [], total: 0 };
      conditions.push(or(...scope.map((p) => like(orgUnits.path, `${p}%`)))!);
    }
    if (f.q) {
      const q = `%${f.q.trim()}%`;
      conditions.push(
        or(
          sql`unaccent(${users.displayName}) ilike unaccent(${q})`,
          ilike(users.username, q),
          ilike(users.email, q),
        )!,
      );
    }
    if (f.status) conditions.push(eq(users.status, f.status));
    if (f.orgUnitId) {
      const unit = await this.org.get(f.orgUnitId);
      conditions.push(like(orgUnits.path, `${unit.path}%`));
    }
    const where = and(...conditions);

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ user: users, unit: orgUnits, cred: userCredentials })
        .from(users)
        .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
        .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(where)
        .orderBy(users.displayName)
        .limit(f.pageSize)
        .offset((f.page - 1) * f.pageSize),
      this.db
        .select({ n: count() })
        .from(users)
        .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
        .where(where),
    ]);
    const roles = await this.rolesOf(rows.map((r) => r.user.id));
    return {
      items: rows.map((r) => this.toAdmin(r.user, r.unit, r.cred, roles.get(r.user.id) ?? [])),
      total: total?.n ?? 0,
    };
  }

  async get(actor: Actor, id: string): Promise<AdminUser> {
    const { user, unit } = await this.loadInScope(actor, id, 'users.read');
    const cred = await this.users.findCredentials(id);
    const roles = await this.rolesOf([id]);
    return this.toAdmin(user, unit, cred ?? null, roles.get(id) ?? []);
  }

  async create(
    actor: Actor,
    input: CreateInput,
  ): Promise<{ user: AdminUser; temporaryPassword: string }> {
    const unit = input.orgUnitId ? await this.org.get(input.orgUnitId) : null;
    this.assertCanManageUnit(actor, unit);
    if (input.kind === 'guest' && !input.accessExpiresAt) {
      throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', {
        accessExpiresAt: ['Informe até quando o convidado terá acesso'],
      });
    }
    const temporaryPassword = this.passwords.generateTemporary();
    let created: UserRow;
    try {
      created = await this.users.create({
        username: input.username,
        displayName: input.displayName,
        email: input.email ?? null,
        jobTitle: input.jobTitle ?? null,
        orgUnitId: unit?.id ?? null,
        kind: input.kind,
        accessExpiresAt: input.accessExpiresAt ? new Date(input.accessExpiresAt) : null,
        passwordHash: await this.passwords.hash(temporaryPassword),
        mustChangePassword: true,
      });
    } catch (e) {
      throw this.translateUnique(e);
    }
    this.changed(created.id);
    await this.record(actor, 'user.created', created.id, {
      username: created.username,
      kind: created.kind,
    });
    return { user: await this.get(actor, created.id), temporaryPassword };
  }

  async update(
    actor: Actor,
    id: string,
    input: UpdateUserRequest & { orgUnitId?: string | null },
  ): Promise<AdminUser> {
    await this.loadInScope(actor, id, 'users.manage');
    if (input.orgUnitId !== undefined) {
      this.assertCanManageUnit(actor, input.orgUnitId ? await this.org.get(input.orgUnitId) : null);
    }
    try {
      await this.db
        .update(users)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
          ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.accessExpiresAt !== undefined
            ? { accessExpiresAt: input.accessExpiresAt ? new Date(input.accessExpiresAt) : null }
            : {}),
        })
        .where(eq(users.id, id));
    } catch (e) {
      throw this.translateUnique(e);
    }
    this.changed(id);
    await this.record(actor, 'user.updated', id, { changes: input });
    return this.get(actor, id);
  }

  async setStatus(actor: Actor, id: string, status: UserStatus): Promise<AdminUser> {
    if (id === actor.id) {
      throw new AppException(
        409,
        'CONFLICT',
        'Você não pode alterar a situação da sua própria conta.',
      );
    }
    const { user } = await this.loadInScope(actor, id, 'users.manage');
    await this.db.update(users).set({ status }).where(eq(users.id, id));
    if (status !== 'active') await this.sessions.revokeAllForUser(id, `status_${status}`);
    // Desbloquear também zera o bloqueio temporário por senhas erradas.
    if (status === 'active') {
      await this.db
        .update(userCredentials)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(userCredentials.userId, id));
    }
    this.changed(id);
    await this.record(actor, 'user.status_changed', id, { from: user.status, to: status });
    return this.get(actor, id);
  }

  async resetPassword(actor: Actor, id: string): Promise<string> {
    const { user } = await this.loadInScope(actor, id, 'users.manage');
    if (user.authSource !== 'local') {
      throw new AppException(
        409,
        'CONFLICT',
        'A senha desta conta é gerenciada pelo Active Directory.',
      );
    }
    const temporary = this.passwords.generateTemporary();
    await this.users.setPassword(id, await this.passwords.hash(temporary), true);
    await this.sessions.revokeAllForUser(id, 'password_reset');
    await this.record(actor, 'auth.password_reset', id, { via: 'admin' });
    return temporary;
  }

  /** Para quem perdeu o celular: desativa o MFA (a pessoa ativa de novo no próximo acesso). */
  async resetMfa(actor: Actor, id: string): Promise<void> {
    if (!actor.grants.hasGlobal('roles.assign')) {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Somente o super administrador pode redefinir a verificação em duas etapas.',
      );
    }
    await this.loadInScope(actor, id, 'users.manage');
    await this.users.setMfa(id, null);
    await this.sessions.revokeAllForUser(id, 'mfa_reset');
    await this.record(actor, 'auth.mfa_reset', id, {});
  }

  /**
   * Exclusão de usuário (somente super administrador). É uma exclusão lógica com
   * anonimização: a pessoa some do diretório e não entra mais; login, e-mail, senha,
   * MFA, foto e papéis são apagados. O nome continua no histórico das conversas, que
   * é documento público e precisa ser preservado.
   */
  async remove(actor: Actor, id: string, confirmUsername: string): Promise<void> {
    if (!actor.grants.hasGlobal('users.delete')) {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Somente o super administrador pode excluir usuários.',
      );
    }
    if (id === actor.id) {
      throw new AppException(409, 'CONFLICT', 'Você não pode excluir a sua própria conta.');
    }
    const { user } = await this.loadInScope(actor, id, 'users.manage');
    if (confirmUsername.trim().toLowerCase() !== user.username) {
      throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', {
        confirmUsername: ['Digite o login exatamente como aparece para confirmar'],
      });
    }
    const [isSuper] = await this.db
      .select({ n: count() })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, id), eq(roleAssignments.role, 'super_admin')));
    if ((isSuper?.n ?? 0) > 0) {
      const [all] = await this.db
        .select({ n: count() })
        .from(roleAssignments)
        .where(eq(roleAssignments.role, 'super_admin'));
      if ((all?.n ?? 0) <= 1) {
        throw new AppException(
          409,
          'CONFLICT',
          'O sistema precisa de ao menos um super administrador.',
        );
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          deletedAt: new Date(),
          status: 'disabled',
          // Libera o login para reuso; "#" nunca é aceito num login, então não colide.
          username: `#excluido-${id}`,
          email: null,
          jobTitle: null,
          externalId: null,
        })
        .where(eq(users.id, id));
      await tx.delete(roleAssignments).where(eq(roleAssignments.userId, id));
      await tx.delete(userCredentials).where(eq(userCredentials.userId, id));
    });
    await this.sessions.revokeAllForUser(id, 'user_deleted');
    this.changed(id);
    await this.avatars.remove(id);
    await this.record(actor, 'user.deleted', id, {
      username: user.username,
      displayName: user.displayName,
    });
  }

  /** Remove a foto de alguém (ex.: imagem imprópria). */
  async removeAvatar(actor: Actor, id: string): Promise<AdminUser> {
    await this.loadInScope(actor, id, 'users.manage');
    if (await this.avatars.remove(id)) await this.record(actor, 'user.avatar_removed', id, {});
    return this.get(actor, id);
  }

  async assignRole(actor: Actor, userId: string, input: AssignRoleRequest): Promise<AdminUser> {
    this.assertCanAssignRoles(actor);
    await this.loadInScope(actor, userId, 'users.read');
    const role = await this.roles.get(input.role).catch(() => {
      throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', {
        role: ['Papel não encontrado'],
      });
    });
    // Quem atribui precisa ter tudo o que o papel concede.
    this.roles.assertCanGrant(actor, rolePermissions(role));
    const unitId = role.scoped ? (input.orgUnitId ?? null) : null;
    if (role.scoped && !unitId) {
      throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', {
        orgUnitId: ['Escolha a unidade que esta pessoa vai administrar'],
      });
    }
    if (unitId) await this.org.get(unitId);
    await this.db
      .insert(roleAssignments)
      .values({ userId, role: input.role, orgUnitId: unitId, createdBy: actor.id })
      .onConflictDoNothing();
    await this.record(actor, 'role.assigned', userId, { role: input.role, orgUnitId: unitId });
    return this.get(actor, userId);
  }

  async removeRole(actor: Actor, userId: string, assignmentId: string): Promise<AdminUser> {
    this.assertCanAssignRoles(actor);
    const [row] = await this.db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.userId, userId)))
      .limit(1);
    if (!row) throw new AppException(404, 'NOT_FOUND', 'Atribuição não encontrada');
    if (row.role === 'super_admin') {
      const [n] = await this.db
        .select({ n: count() })
        .from(roleAssignments)
        .where(eq(roleAssignments.role, 'super_admin'));
      if ((n?.n ?? 0) <= 1) {
        throw new AppException(
          409,
          'CONFLICT',
          'O sistema precisa de ao menos um super administrador.',
        );
      }
    }
    await this.db.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId));
    await this.record(actor, 'role.removed', userId, { role: row.role, orgUnitId: row.orgUnitId });
    return this.get(actor, userId);
  }

  private assertCanAssignRoles(actor: Actor): void {
    if (!actor.grants.hasGlobal('roles.assign')) {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Somente o super administrador pode atribuir papéis.',
      );
    }
  }

  private assertCanManageUnit(actor: Actor, unit: OrgUnitRow | null): void {
    if (!actor.grants.canOn('users.manage', unit?.path ?? null)) {
      throw new AppException(
        403,
        'FORBIDDEN',
        unit ? 'Você não administra esta unidade.' : 'Escolha uma unidade que você administra.',
      );
    }
  }

  private async loadInScope(actor: Actor, id: string, permission: 'users.read' | 'users.manage') {
    const [row] = await this.db
      .select({ user: users, unit: orgUnits })
      .from(users)
      .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    // Fora do escopo responde como inexistente: não revela quem existe em outras unidades.
    if (!row || !actor.grants.canOn(permission, row.unit?.path ?? null)) {
      if (
        row &&
        permission === 'users.manage' &&
        actor.grants.canOn('users.read', row.unit?.path ?? null)
      ) {
        throw new AppException(403, 'FORBIDDEN', 'Você não administra a unidade desta pessoa.');
      }
      throw new AppException(404, 'NOT_FOUND', 'Usuário não encontrado');
    }
    return row;
  }

  private async rolesOf(userIds: string[]): Promise<Map<string, RoleAssignment[]>> {
    if (!userIds.length) return new Map();
    const rows = await this.db
      .select({ a: roleAssignments, unit: orgUnits, roleName: roles.name })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.key, roleAssignments.role))
      .leftJoin(orgUnits, eq(orgUnits.id, roleAssignments.orgUnitId))
      .where(inArray(roleAssignments.userId, userIds))
      .orderBy(desc(roleAssignments.createdAt));
    const map = new Map<string, RoleAssignment[]>();
    for (const r of rows) {
      const list = map.get(r.a.userId) ?? [];
      list.push({
        id: r.a.id,
        role: r.a.role,
        roleName: r.roleName,
        orgUnit: unitRef(r.unit),
        createdAt: r.a.createdAt.toISOString(),
      });
      map.set(r.a.userId, list);
    }
    return map;
  }

  private toAdmin(
    u: UserRow,
    unit: OrgUnitRow | null,
    cred: { mfaEnabledAt: Date | null; lockedUntil: Date | null } | null,
    roles: RoleAssignment[],
  ): AdminUser {
    const locked =
      cred?.lockedUntil && cred.lockedUntil > new Date() ? cred.lockedUntil.toISOString() : null;
    return {
      ...this.users.toPublic(u, unit, !!cred?.mfaEnabledAt),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      accessExpiresAt: u.accessExpiresAt?.toISOString() ?? null,
      lockedUntil: locked,
      roles,
    };
  }

  private record(
    actor: Actor,
    action: Parameters<AuditService['record']>[0]['action'],
    userId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId: actor.id,
      entityType: 'user',
      entityId: userId,
      ip: actor.ip,
      userAgent: actor.userAgent,
      metadata,
    });
  }

  private translateUnique(e: unknown): unknown {
    const err = e as {
      code?: string;
      constraint_name?: string;
      cause?: { code?: string; constraint_name?: string };
    };
    const code = err.cause?.code ?? err.code;
    const constraint = err.cause?.constraint_name ?? err.constraint_name ?? '';
    if (code !== '23505') return e;
    return constraint.includes('email')
      ? new AppException(409, 'CONFLICT', 'Dados inválidos', {
          email: ['Este e-mail já está em uso'],
        })
      : new AppException(409, 'CONFLICT', 'Dados inválidos', {
          username: ['Este usuário já existe'],
        });
  }
}
