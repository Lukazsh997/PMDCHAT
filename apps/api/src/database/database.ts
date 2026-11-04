import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import * as schema from './schema/index.js';

export const DB = Symbol('DB');
export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

export function createDatabase(url: string, max = 10): Database {
  const client = postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  return drizzle(client, { schema, casing: 'snake_case' });
}

/** Pasta `drizzle/` na raiz do app (mesmo caminho relativo a partir de `src/` e de `dist/`). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Database, folder = MIGRATIONS_DIR): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
