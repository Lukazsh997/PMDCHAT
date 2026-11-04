import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { DirectoryUser } from '@plataforma/contracts';
import { and, eq, gt, isNull, like, ne, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppException } from '../../common/app-exception.js';
import { CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Database } from '../../database/database.js';
import { orgUnits, users } from '../../database/schema/index.js';
import type { AuthContext } from '../auth/index.js';
import { toDirectory } from '../users/index.js';

const query = z.object({
  q: z.string().trim().max(100).optional(),
  orgUnitId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Busca de pessoas para iniciar conversas (decisão: todos podem falar com todos). */
@Controller('directory')
export class DirectoryController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('users')
  async search(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(query)) q: z.infer<typeof query>,
  ): Promise<DirectoryUser[]> {
    if (auth.user.kind === 'guest') {
      throw new AppException(
        403,
        'FORBIDDEN',
        'Convidados participam apenas das conversas em que foram incluídos.',
      );
    }
    const c: SQL[] = [
      isNull(users.deletedAt),
      eq(users.status, 'active'),
      ne(users.id, auth.user.id),
      or(isNull(users.accessExpiresAt), gt(users.accessExpiresAt, new Date()))!,
    ];
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
      const [unit] = await this.db
        .select()
        .from(orgUnits)
        .where(eq(orgUnits.id, q.orgUnitId))
        .limit(1);
      if (unit) c.push(like(orgUnits.path, `${unit.path}%`));
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
}
