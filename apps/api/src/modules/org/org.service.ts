import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateOrgUnitRequest,
  OrgUnit,
  OrgUnitKind,
  UpdateOrgUnitRequest,
} from '@plataforma/contracts';
import { and, asc, count, eq, isNull, like, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppException } from '../../common/app-exception.js';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import { orgUnits, type OrgUnitRow, users } from '../../database/schema/index.js';

@Injectable()
export class OrgService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
  ) {}

  /** Árvore completa em ordem de exibição (pais antes dos filhos). */
  async list(): Promise<OrgUnit[]> {
    const counts = this.db
      .select({ unitId: users.orgUnitId, n: count().as('n') })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.status, 'active')))
      .groupBy(users.orgUnitId)
      .as('counts');
    const rows = await this.db
      .select({ unit: orgUnits, members: counts.n })
      .from(orgUnits)
      .leftJoin(counts, eq(counts.unitId, orgUnits.id))
      .orderBy(asc(orgUnits.depth), asc(orgUnits.name));

    // Ordena em profundidade: cada unidade seguida de suas filhas, por nome.
    const children = new Map<string | null, typeof rows>();
    for (const r of rows) {
      const k = r.unit.parentId;
      children.set(k, [...(children.get(k) ?? []), r]);
    }
    const out: OrgUnit[] = [];
    const walk = (parent: string | null) => {
      for (const r of children.get(parent) ?? []) {
        out.push(this.toDto(r.unit, Number(r.members ?? 0)));
        walk(r.unit.id);
      }
    };
    walk(null);
    return out;
  }

  async get(id: string): Promise<OrgUnitRow> {
    const [row] = await this.db.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1);
    if (!row) throw new AppException(404, 'NOT_FOUND', 'Unidade não encontrada');
    return row;
  }

  async create(input: CreateOrgUnitRequest): Promise<OrgUnitRow> {
    const parent = input.parentId ? await this.get(input.parentId) : null;
    const id = uuidv7();
    try {
      const [row] = await this.db
        .insert(orgUnits)
        .values({
          id,
          parentId: parent?.id ?? null,
          kind: input.kind,
          name: input.name,
          acronym: input.acronym ?? null,
          path: `${parent?.path ?? '/'}${id}/`,
          depth: parent ? parent.depth + 1 : 0,
        })
        .returning();
      return row!;
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(id: string, input: UpdateOrgUnitRequest): Promise<OrgUnitRow> {
    const current = await this.get(id);
    const row = await this.db.transaction(async (tx) => {
      let path = current.path;
      let depth = current.depth;

      if (input.parentId !== undefined && input.parentId !== current.parentId) {
        const parent = input.parentId ? await this.get(input.parentId) : null;
        if (parent && parent.path.startsWith(current.path)) {
          throw new AppException(400, 'VALIDATION_FAILED', 'Dados inválidos', {
            parentId: ['Uma unidade não pode ficar dentro dela mesma ou de uma subordinada'],
          });
        }
        path = `${parent?.path ?? '/'}${id}/`;
        depth = parent ? parent.depth + 1 : 0;
        // Reescreve o caminho de toda a subárvore numa única instrução.
        await tx
          .update(orgUnits)
          .set({
            // ::int evita que o PostgreSQL trate a posição como expressão regular.
            path: sql`${path}::text || substr(${orgUnits.path}, ${current.path.length + 1}::int)`,
            depth: sql`${orgUnits.depth} + ${depth - current.depth}::int`,
          })
          .where(and(like(orgUnits.path, `${current.path}%`), sql`${orgUnits.id} <> ${id}`));
      }

      try {
        const [row] = await tx
          .update(orgUnits)
          .set({
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.name ? { name: input.name } : {}),
            ...(input.acronym !== undefined ? { acronym: input.acronym } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            path,
            depth,
          })
          .where(eq(orgUnits.id, id))
          .returning();
        return row!;
      } catch (e) {
        throw this.translate(e);
      }
    });
    // Mover ou (des)ativar muda quem está abaixo de cada unidade: canais se ajustam.
    if (input.parentId !== undefined || input.isActive !== undefined) {
      this.events.emit('org.changed', {});
    }
    return row;
  }

  async remove(id: string): Promise<OrgUnitRow> {
    const unit = await this.get(id);
    const [kids] = await this.db
      .select({ n: count() })
      .from(orgUnits)
      .where(eq(orgUnits.parentId, id));
    if (kids!.n > 0) {
      throw new AppException(
        409,
        'CONFLICT',
        'Remova ou mova as unidades subordinadas antes de excluir esta.',
      );
    }
    const [people] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.orgUnitId, id), isNull(users.deletedAt)));
    if (people!.n > 0) {
      throw new AppException(
        409,
        'CONFLICT',
        `Há ${people!.n} pessoa(s) lotada(s) nesta unidade. Mova-as antes de excluir, ou desative a unidade.`,
      );
    }
    await this.db.delete(orgUnits).where(eq(orgUnits.id, id));
    return unit;
  }

  toDto(u: OrgUnitRow, memberCount = 0): OrgUnit {
    return {
      id: u.id,
      parentId: u.parentId,
      kind: u.kind as OrgUnitKind,
      name: u.name,
      acronym: u.acronym,
      isActive: u.isActive,
      depth: u.depth,
      memberCount,
    };
  }

  private translate(e: unknown): unknown {
    const code =
      (e as { code?: string; cause?: { code?: string } }).cause?.code ??
      (e as { code?: string }).code;
    return code === '23505'
      ? new AppException(409, 'CONFLICT', 'Já existe uma unidade com este nome no mesmo nível.')
      : e;
  }
}
