import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { DirectoryUser, OrgTree, OrgTreeUnit, OrgUnitKind } from '@plataforma/contracts';
import { and, count, eq, gt, inArray, isNull, like, ne, or, type SQL, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Database } from '../../database/database.js';
import { orgUnits, users } from '../../database/schema/index.js';
import { REDIS } from '../../redis/redis.module.js';
import type { AuthContext } from '../auth/index.js';
import { connectedUserIds } from '../realtime/index.js';
import { toDirectory } from '../users/index.js';

const query = z.object({
  q: z.string().trim().max(100).optional(),
  orgUnitId: z.uuid().optional(),
  /** `direct`: só quem está lotado na própria unidade (sem as subunidades). */
  scope: z.enum(['tree', 'direct']).default('tree'),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

/** Pessoas que aparecem no diretório: ativas, não excluídas, convidados dentro do prazo. */
const visible = (): SQL[] => [
  isNull(users.deletedAt),
  eq(users.status, 'active'),
  or(isNull(users.accessExpiresAt), gt(users.accessExpiresAt, new Date()))!,
];

/** Diretório e organograma (decisão: todos podem falar com todos). */
@Controller('directory')
export class DirectoryController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('users')
  async search(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(query)) q: z.infer<typeof query>,
  ): Promise<DirectoryUser[]> {
    this.assertMember(auth);
    const c: SQL[] = [...visible(), ne(users.id, auth.user.id)];
    if (q.q) {
      const term = `%${q.q}%`;
      c.push(
        or(
          sql`unaccent(${users.displayName}) ilike unaccent(${term})`,
          sql`${users.username} ilike ${term}`,
          sql`unaccent(coalesce(${users.jobTitle}, '')) ilike unaccent(${term})`,
          sql`unaccent(coalesce(${orgUnits.name}, '')) ilike unaccent(${term})`,
          sql`coalesce(${orgUnits.acronym}, '') ilike ${term}`,
        )!,
      );
    }
    if (q.orgUnitId) {
      if (q.scope === 'direct') {
        c.push(eq(users.orgUnitId, q.orgUnitId));
      } else {
        const [unit] = await this.db
          .select()
          .from(orgUnits)
          .where(eq(orgUnits.id, q.orgUnitId))
          .limit(1);
        if (unit) c.push(like(orgUnits.path, `${unit.path}%`));
      }
    }
    const rows = await this.db
      .select({ user: users, unit: orgUnits })
      .from(users)
      .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
      .where(and(...c))
      .orderBy(users.displayName)
      .limit(q.limit);
    return rows.map((r) => toDirectory(r.user, r.unit));
  }

  /**
   * Organograma para navegação: unidades ativas com quantas pessoas estão lotadas
   * diretamente em cada uma e quantas estão conectadas. Quem usa soma as subunidades.
   */
  @Get('org-tree')
  async tree(@CurrentAuth() auth: AuthContext): Promise<OrgTree> {
    this.assertMember(auth);
    const online = await connectedUserIds(this.redis);
    const [units, members, connected] = await Promise.all([
      this.db.select().from(orgUnits).orderBy(orgUnits.depth, orgUnits.name),
      this.db
        .select({ unitId: users.orgUnitId, n: count() })
        .from(users)
        .where(and(...visible()))
        .groupBy(users.orgUnitId),
      online.length
        ? this.db
            .select({ unitId: users.orgUnitId, n: count() })
            .from(users)
            .where(and(...visible(), inArray(users.id, online)))
            .groupBy(users.orgUnitId)
        : Promise.resolve([]),
    ]);
    const memberMap = new Map(members.map((r) => [r.unitId, r.n]));
    const onlineMap = new Map(connected.map((r) => [r.unitId, r.n]));

    // Unidade desativada some junto com tudo o que está abaixo dela.
    const inactive = units.filter((u) => !u.isActive).map((u) => `/${u.id}/`);
    const out: OrgTreeUnit[] = units
      .filter((u) => !inactive.some((p) => u.path.includes(p)))
      .map((u) => ({
        id: u.id,
        parentId: u.parentId,
        kind: u.kind as OrgUnitKind,
        name: u.name,
        acronym: u.acronym,
        depth: u.depth,
        memberCount: memberMap.get(u.id) ?? 0,
        onlineCount: onlineMap.get(u.id) ?? 0,
      }));
    return {
      units: out,
      unassigned: { memberCount: memberMap.get(null) ?? 0, onlineCount: onlineMap.get(null) ?? 0 },
    };
  }

  private assertMember(auth: AuthContext): void {
    if (auth.user.kind === 'guest') {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Convidados participam apenas das conversas em que foram incluídos.',
      );
    }
  }
}
