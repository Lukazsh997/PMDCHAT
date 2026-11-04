import { Inject, Injectable } from '@nestjs/common';
import type { PublicUser } from '@plataforma/contracts';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../database/database.js';
import {
  type NewUserRow,
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
  passwordHash: string;
  isSuperAdmin?: boolean;
  mustChangePassword?: boolean;
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

  /** Busca o usuário e suas credenciais para o fluxo de login. */
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
        isSuperAdmin: input.isSuperAdmin ?? false,
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

  toPublic(u: UserRow): PublicUser {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      jobTitle: u.jobTitle,
      status: u.status,
      authSource: u.authSource,
      isSuperAdmin: u.isSuperAdmin,
      mustChangePassword: u.mustChangePassword,
    };
  }
}
