import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { REDIS } from '../../redis/redis.module.js';
import { LdapSettingsService } from './ldap-settings.service.js';
import { LdapSyncService } from './ldap-sync.service.js';

const QUEUE = 'ldap';
const TICK_MS = 5 * 60_000;

/**
 * Sincronização periódica com o AD. Um agendamento do BullMQ (um só, mesmo com várias
 * instâncias da API) dispara a cada 5 minutos; a sincronização roda se a integração
 * está ligada e o intervalo configurado já passou desde a última. Roda no processo da
 * API, não no worker: os eventos de domínio (lotação → canais da unidade, sessões
 * revogadas → tempo real) vivem aqui. Ver ADR 0018.
 */
@Injectable()
export class LdapScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(LdapScheduler.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: LdapSettingsService,
    private readonly sync: LdapSyncService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.NODE_ENV === 'test') return;
    const connection = () => this.redis.duplicate({ maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, {
      connection: connection(),
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 100 },
    });
    this.worker = new Worker(QUEUE, () => this.tick(), {
      connection: connection(),
      concurrency: 1,
    });
    this.worker.on('error', (e) => this.logger.warn(`Fila do AD: ${e.message}`));
    await this.queue
      .upsertJobScheduler('ldap-sync-tick', { every: TICK_MS }, { name: 'tick' })
      .catch((e: unknown) => this.logger.warn(`Agendamento do AD indisponível: ${String(e)}`));
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  /** Público para os testes. */
  async tick(now = new Date()): Promise<boolean> {
    const active = await this.settings.activeGateway();
    if (!active) return false;
    const last = await this.sync.lastFinishedAt();
    if (last && now.getTime() - last.getTime() < active.row.syncIntervalMinutes * 60_000) {
      return false;
    }
    try {
      await this.sync.run({ trigger: 'schedule', actorId: null });
    } catch (e) {
      // Outra sincronização em andamento (manual): tudo bem, fica para o próximo ciclo.
      this.logger.debug(`Sincronização agendada não rodou: ${String(e)}`);
    }
    return true;
  }
}
