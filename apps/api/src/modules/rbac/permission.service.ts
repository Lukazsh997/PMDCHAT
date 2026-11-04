import { Inject, Injectable } from '@nestjs/common';
import { type Permission, ROLES, type RoleKey, roleRequiresMfa } from '@plataforma/contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../database/database.js';
import { orgUnits, roleAssignments } from '../../database/schema/index.js';

export interface Grant {
  id: string;
  role: RoleKey;
  /** null = global. */
  orgUnitId: string | null;
  /** Caminho materializado da unidade do escopo. */
  orgUnitPath: string | null;
}

/**
 * Conjunto de papéis de um usuário, com as perguntas que o resto do sistema faz:
 * "pode X?", "pode X sobre esta unidade?", "em quais unidades pode X?".
 */
export class Grants {
  constructor(readonly items: Grant[]) {}

  get permissions(): Permission[] {
    const set = new Set<Permission>();
    for (const g of this.items) for (const p of ROLES[g.role].permissions) set.add(p);
    return [...set];
  }

  /** Tem a permissão em algum escopo. */
  hasAny(permission: Permission): boolean {
    return this.items.some((g) => this.grants(g, permission));
  }

  hasGlobal(permission: Permission): boolean {
    return this.items.some((g) => g.orgUnitId === null && this.grants(g, permission));
  }

  /** Pode agir sobre algo lotado na unidade `path` (null = sem lotação: só escopo global). */
  canOn(permission: Permission, path: string | null): boolean {
    return this.items.some(
      (g) =>
        this.grants(g, permission) &&
        (g.orgUnitPath === null || (path !== null && path.startsWith(g.orgUnitPath))),
    );
  }

  /** null = escopo global; senão, os caminhos das unidades em que tem a permissão. */
  scopePaths(permission: Permission): string[] | null {
    const relevant = this.items.filter((g) => this.grants(g, permission));
    if (relevant.some((g) => g.orgUnitPath === null)) return null;
    return relevant.map((g) => g.orgUnitPath as string);
  }

  get requiresMfa(): boolean {
    return this.items.some((g) => roleRequiresMfa(g.role));
  }

  private grants(g: Grant, permission: Permission): boolean {
    return (ROLES[g.role].permissions as readonly Permission[]).includes(permission);
  }
}

@Injectable()
export class PermissionService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async grantsFor(userId: string): Promise<Grants> {
    const rows = await this.db
      .select({
        id: roleAssignments.id,
        role: roleAssignments.role,
        orgUnitId: roleAssignments.orgUnitId,
        orgUnitPath: orgUnits.path,
      })
      .from(roleAssignments)
      .leftJoin(orgUnits, eq(orgUnits.id, roleAssignments.orgUnitId))
      .where(eq(roleAssignments.userId, userId));
    return new Grants(
      rows
        .filter((r) => r.role in ROLES)
        .map((r) => ({ ...r, role: r.role as RoleKey, orgUnitPath: r.orgUnitPath ?? null })),
    );
  }
}
