import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateRoleRequest,
  type Permission,
  type RoleDefinition,
  SUPER_ADMIN,
  type UpdateRoleRequest,
} from '@plataforma/contracts';
import { asc, count, eq } from 'drizzle-orm';
import { AppException } from '../../common/app-exception.js';
import { DB, type Database } from '../../database/database.js';
import { roleAssignments, type RoleRow, roles } from '../../database/schema/index.js';
import { AuditService } from '../audit/index.js';
import { type Grants, rolePermissions } from '../rbac/index.js';

interface Actor {
  id: string;
  grants: Grants;
  ip: string | null;
  userAgent: string | null;
}

/** Chave legível a partir do nome: "Gestor de Ouvidoria" → "gestor_de_ouvidoria". */
function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 26) || 'papel'
  );
}

/**
 * Papéis editáveis. Regras que impedem escalada de privilégio: só se dá a um papel
 * (e só se atribui) o que você mesmo tem no sistema todo; o super administrador não
 * muda; papel de sistema não é excluído; papel em uso não troca de tipo de escopo.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleDefinition[]> {
    const [rows, counts] = await Promise.all([
      this.db.select().from(roles).orderBy(asc(roles.isSystem), asc(roles.name)),
      this.db
        .select({ role: roleAssignments.role, n: count() })
        .from(roleAssignments)
        .groupBy(roleAssignments.role),
    ]);
    const used = new Map(counts.map((c) => [c.role, c.n]));
    // Os de sistema primeiro, com o super administrador no topo.
    return rows
      .map((r) => this.toDto(r, used.get(r.key) ?? 0))
      .sort(
        (a, b) =>
          Number(b.locked) - Number(a.locked) ||
          Number(b.isSystem) - Number(a.isSystem) ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
  }

  async get(key: string): Promise<RoleRow> {
    const [row] = await this.db.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (!row) throw new AppException(404, 'NOT_FOUND', 'Papel não encontrado');
    return row;
  }

  async create(actor: Actor, input: CreateRoleRequest): Promise<RoleDefinition> {
    this.assertCanGrant(actor, input.permissions as Permission[]);
    const base = slug(input.name);
    let key = base;
    for (let i = 2; await this.exists(key); i++) key = `${base}_${i}`;
    const [row] = await this.db
      .insert(roles)
      .values({
        key,
        name: input.name.trim(),
        description: input.description?.trim() ?? '',
        scoped: input.scoped,
        permissions: [...new Set(input.permissions)],
      })
      .returning();
    await this.record(actor, 'role.created', key, {
      name: row!.name,
      permissions: row!.permissions,
    });
    return this.toDto(row!, 0);
  }

  async update(actor: Actor, key: string, input: UpdateRoleRequest): Promise<RoleDefinition> {
    const current = await this.get(key);
    if (current.key === SUPER_ADMIN) {
      throw new AppException(409, 'CONFLICT', 'O super administrador não pode ser alterado.');
    }
    const assigned = await this.assignmentCount(key);
    if (input.scoped !== undefined && input.scoped !== current.scoped && assigned > 0) {
      throw new AppException(
        409,
        'CONFLICT',
        'Este papel está atribuído a pessoas: não dá para mudar se ele vale numa unidade ou no sistema todo.',
      );
    }
    if (input.permissions) this.assertCanGrant(actor, input.permissions as Permission[]);
    const [row] = await this.db
      .update(roles)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.scoped !== undefined ? { scoped: input.scoped } : {}),
        ...(input.permissions ? { permissions: [...new Set(input.permissions)] } : {}),
      })
      .where(eq(roles.key, key))
      .returning();
    await this.record(actor, 'role.updated', key, {
      before: { name: current.name, scoped: current.scoped, permissions: current.permissions },
      after: { name: row!.name, scoped: row!.scoped, permissions: row!.permissions },
    });
    return this.toDto(row!, assigned);
  }

  async remove(actor: Actor, key: string): Promise<void> {
    const current = await this.get(key);
    if (current.isSystem) {
      throw new AppException(409, 'CONFLICT', 'Papéis de sistema não podem ser excluídos.');
    }
    const assigned = await this.assignmentCount(key);
    if (assigned > 0) {
      throw new AppException(
        409,
        'CONFLICT',
        `Este papel está atribuído a ${assigned} ${assigned === 1 ? 'pessoa' : 'pessoas'}. Remova as atribuições antes de excluir.`,
      );
    }
    await this.db.delete(roles).where(eq(roles.key, key));
    await this.record(actor, 'role.deleted', key, { name: current.name });
  }

  /** Só se concede o que se tem no sistema todo. */
  assertCanGrant(actor: Actor, permissions: readonly Permission[]): void {
    const missing = permissions.filter((p) => !actor.grants.hasGlobal(p));
    if (missing.length) {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Você não pode conceder permissões que você mesmo não tem no sistema todo.',
      );
    }
  }

  toDto(r: RoleRow, assignmentCount: number): RoleDefinition {
    return {
      key: r.key,
      name: r.name,
      description: r.description,
      scoped: r.scoped,
      isSystem: r.isSystem,
      locked: r.key === SUPER_ADMIN,
      permissions: rolePermissions(r),
      assignmentCount,
    };
  }

  private async exists(key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.key, key))
      .limit(1);
    return !!row;
  }

  private async assignmentCount(key: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(roleAssignments)
      .where(eq(roleAssignments.role, key));
    return row?.n ?? 0;
  }

  private record(
    actor: Actor,
    action: 'role.created' | 'role.updated' | 'role.deleted',
    key: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId: actor.id,
      entityType: 'role',
      entityId: key,
      ip: actor.ip,
      userAgent: actor.userAgent,
      metadata,
    });
  }
}
