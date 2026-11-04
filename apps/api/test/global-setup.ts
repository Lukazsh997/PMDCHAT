import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';

/** Recria o banco de testes do zero e aplica as migrações uma vez por execução. */
export default async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://plataforma:plataforma@localhost:5432/plataforma_test';
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await sql`drop schema if exists drizzle cascade`;
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    await migrate(drizzle(sql), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  } finally {
    await sql.end();
  }
}
