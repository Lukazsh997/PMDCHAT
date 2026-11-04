import { Inject, Injectable } from '@nestjs/common';
import type { DirectoryUser, OrgUnitRef, PublicUser } from '@plataforma/contracts';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../database/database.js';
import {
  type NewUserRow,
  orgUnits,
  type OrgUnitRow,
  userCredentials,
  type UserCredentialsRow,
  type UserRow,
  users,
} from '../../database/schema/index.js';

export interface CreateUserInput {
  username: string;
  displayName: string;
  email?: string | null;
  jobTitle?: string | null;
  orgUnitId?: string | null;
  kind?: 'member' | 'guest';
  accessExpiresAt?: Date | null;
  passwordHash: string;
  mustChangePassword?: boolean;
}

/** Usuário carregado com o que as requisições autenticadas precisam. */
export interface LoadedUser {
  user: UserRow;
  orgUnit: OrgUnitRow | null;
  mfaEnabled: boolean;
}

export function unitRef(u: Pick<OrgUnitRow, 'id' | 'name' | 'acronym'> | null): OrgUnitRef | null {
  return u ? { id: u.id, name: u.name, acronym: u.acronym } : null;
}

/** Usuário pode usar o sistema agora? (ativo e, se convidado, dentro do prazo). */
export function isUsable(u: Pick<UserRow, 'status' | 'accessExpiresAt' | 'deletedAt'>): boolean {
  return (
    u.status === 'active' &&
    !u.deletedAt &&
    (!u.accessExpiresAt || u.accessExpiresAt.getTime() > Date.now())
  );
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  /** Uma consulta por requisição autenticada: usuário, lotação e estado do MFA. */
  async load(id: string): Promise<LoadedUser | undefined> {
    const [row] = await this.db
      .select({ user: users, orgUnit: orgUnits, mfaEnabledAt: userCredentials.mfaEnabledAt })
      .from(users)
      .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
      .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row && { user: row.user, orgUnit: row.orgUnit, mfaEnabled: !!row.mfaEnabledAt };
  }

  async findForLogin(
    username: string,
  ): Promise<{ user: UserRow; credentials: UserCredentialsRow | null } | undefined> {
    const [row] = await this.db
      .select({ user: users, credentials: userCredentials })
      .from(users)
      .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
      .where(and(eq(users.username, username.toLowerCase()), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  async findCredentials(userId: string): Promise<UserCredentialsRow | undefined> {
    const [row] = await this.db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, userId))
      .limit(1);
    return row;
  }

  async countUsers(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users);
    return row?.n ?? 0;
  }

  async create(input: CreateUserInput): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const values: NewUserRow = {
        username: input.username.toLowerCase(),
        displayName: input.displayName,
        email: input.email ?? null,
        jobTitle: input.jobTitle ?? null,
        orgUnitId: input.orgUnitId ?? null,
        kind: input.kind ?? 'member',
        accessExpiresAt: input.accessExpiresAt ?? null,
        mustChangePassword: input.mustChangePassword ?? false,
      };
      const [user] = await tx.insert(users).values(values).returning();
      if (!user) throw new Error('Falha ao criar usuário');
      await tx
        .insert(userCredentials)
        .values({ userId: user.id, passwordHash: input.passwordHash });
      return user;
    });
  }

  async recordFailedAttempt(userId: string, attempts: number, lockedUntil: Date | null) {
    await this.db
      .update(userCredentials)
      .set({ failedAttempts: attempts, lockedUntil })
      .where(eq(userCredentials.userId, userId));
  }

  async recordSuccessfulLogin(userId: string, newPasswordHash?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(userCredentials)
        .set({
          failedAttempts: 0,
          lockedUntil: null,
          ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
        })
        .where(eq(userCredentials.userId, userId));
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
    });
  }

  async setPassword(userId: string, passwordHash: string, mustChange: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(userCredentials)
        .set({ passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null })
        .where(eq(userCredentials.userId, userId));
      await tx.update(users).set({ mustChangePassword: mustChange }).where(eq(users.id, userId));
    });
  }

  async setMfa(userId: string, secretEnc: string | null): Promise<void> {
    await this.db
      .update(userCredentials)
      .set({ mfaSecretEnc: secretEnc, mfaEnabledAt: secretEnc ? new Date() : null })
      .where(eq(userCredentials.userId, userId));
  }

  /** Pessoas para exibir (diretório, membros de conversa), com a lotação. */
  async directoryUsers(ids: string[]): Promise<Map<string, DirectoryUser>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ user: users, unit: orgUnits })
      .from(users)
      .leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
      .where(inArray(users.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.user.id, toDirectory(r.user, r.unit)]));
  }

  toPublic(u: UserRow, unit: OrgUnitRow | null, mfaEnabled: boolean): PublicUser {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      jobTitle: u.jobTitle,
      status: u.status,
      kind: u.kind,
      authSource: u.authSource,
      orgUnit: unitRef(unit),
      mustChangePassword: u.mustChangePassword,
      mfaEnabled,
    };
  }
}

export function toDirectory(u: UserRow, unit: OrgUnitRow | null): DirectoryUser {
  return {
    id: u.id,
    displayName: u.displayName,
    username: u.username,
    jobTitle: u.jobTitle,
    kind: u.kind,
    orgUnit: unitRef(unit),
  };
}
