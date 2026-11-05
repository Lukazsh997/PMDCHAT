import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import {
  MAINTENANCE_QUEUE,
  type MaintenanceJobName,
  maintenanceJobs,
  maintenanceSchedule,
} from './jobs/maintenance.js';

/**
 * Processo worker: mesmo código da API, papel diferente. Executa tarefas
 * assíncronas e recorrentes (limpezas, e nas próximas fases: miniaturas,
 * antivírus, notificações, indexação e sincronização LDAP).
 */
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker-heartbeat';

async function main(): Promise<void> {
  const config = loadConfig();
  Logger.overrideLogger(new ConsoleLogger({ json: config.NODE_ENV === 'production' }));
  const log = new Logger('Worker');
  const db = createDatabase(config.DATABASE_URL, 4);
  // BullMQ exige conexões sem limite de tentativas por comando.
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue(MAINTENANCE_QUEUE, { connection });
  for (const [name, every] of Object.entries(maintenanceSchedule)) {
    await queue.upsertJobScheduler(
      name,
      { every },
      { name, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
  }

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      const handler = maintenanceJobs[job.name as MaintenanceJobName];
      if (!handler) throw new Error(`Tarefa desconhecida: ${job.name}`);
      return handler({ db, filesDir: config.FILES_DIR });
    },
    { connection, concurrency: 1 },
  );
  worker.on('completed', (job, result) =>
    log.log(`${job.name} concluída: ${JSON.stringify(result)}`),
  );
  worker.on('failed', (job, err) => log.error(`${job?.name ?? '?'} falhou: ${err.message}`));
  log.log('Worker iniciado');

  // Sinal de vida para o healthcheck do Docker: o arquivo é renovado enquanto o
  // worker consegue falar com o Valkey. Arquivo parado há mais de 1 min = worker travado.
  const heartbeat = async () => {
    try {
      await connection.ping();
      await writeFile(HEARTBEAT_FILE, new Date().toISOString());
    } catch (err) {
      log.warn(`Heartbeat falhou: ${String(err)}`);
    }
  };
  await heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat(), 20_000);

  const shutdown = async (signal: string) => {
    log.log(`Recebido ${signal}, encerrando…`);
    clearInterval(heartbeatTimer);
    await worker.close();
    await queue.close();
    await connection.quit();
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
