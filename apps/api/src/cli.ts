import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config/config.js';
import { createDatabase, runMigrations } from './database/database.js';
import { AuditService } from './modules/audit/index.js';
import { PasswordService, SessionService } from './modules/auth/index.js';
import { createRedis } from './redis/redis.module.js';
import { UsersService } from './modules/users/index.js';
import { passwordSchema, usernameSchema } from '@plataforma/contracts';

const HELP = `Uso: node dist/cli.js <comando>

Comandos:
  migrate                  Aplica as migrações pendentes do banco de dados
  bootstrap-admin          Cria o administrador inicial se o banco não tiver usuários
                           (usa BOOTSTRAP_ADMIN_USERNAME e BOOTSTRAP_ADMIN_PASSWORD)
  reset-password <usuário> Gera uma senha temporária e encerra as sessões do usuário
`;

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, 2);
  const users = new UsersService(db);
  const passwords = new PasswordService();
  const audit = new AuditService(db);

  try {
    switch (command) {
      case 'migrate': {
        await runMigrations(db);
        console.log('Migrações aplicadas.');
        break;
      }
      case 'bootstrap-admin': {
        if ((await users.countUsers()) > 0) {
          console.log('Já existem usuários; nenhum administrador inicial foi criado.');
          break;
        }
        const password = config.BOOTSTRAP_ADMIN_PASSWORD;
        if (!password) {
          console.log('BOOTSTRAP_ADMIN_PASSWORD não definido; administrador inicial não criado.');
          break;
        }
        const pw = passwordSchema.safeParse(password);
        if (!pw.success)
          throw new Error(`BOOTSTRAP_ADMIN_PASSWORD fraca: ${pw.error.issues[0]?.message}`);
        const username = usernameSchema.parse(config.BOOTSTRAP_ADMIN_USERNAME);
        const user = await users.create({
          username,
          displayName: 'Administrador',
          passwordHash: await passwords.hash(password),
          isSuperAdmin: true,
          mustChangePassword: true,
        });
        await audit.record({
          action: 'user.created',
          entityType: 'user',
          entityId: user.id,
          metadata: { via: 'cli.bootstrap-admin' },
        });
        console.log(
          `Administrador "${username}" criado. A troca de senha será exigida no primeiro acesso.`,
        );
        break;
      }
      case 'reset-password': {
        if (!arg) throw new Error('Informe o usuário: reset-password <usuário>');
        const found = await users.findForLogin(usernameSchema.parse(arg));
        if (!found) throw new Error(`Usuário "${arg}" não encontrado`);
        const temporary = `${randomBytes(6).toString('base64url')}-${(randomBytes(2).readUInt16BE() % 90) + 10}`;
        await users.setPassword(found.user.id, await passwords.hash(temporary), true);
        const redis = createRedis(config.REDIS_URL);
        try {
          await new SessionService(config, db, redis).revokeAllForUser(
            found.user.id,
            'password_reset',
          );
        } finally {
          await redis.quit();
        }
        await audit.record({
          action: 'auth.password_reset',
          entityType: 'user',
          entityId: found.user.id,
          metadata: { via: 'cli' },
        });
        console.log(`Senha temporária de "${found.user.username}": ${temporary}`);
        console.log('O usuário deverá trocá-la no próximo acesso.');
        break;
      }
      default:
        console.error(`Comando desconhecido: ${command}\n`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
