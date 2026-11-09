import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { PushConfig, PushSubscriptionRequest } from '@plataforma/contracts';
import { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DomainEvents } from '../../common/events/domain-events.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { DB, type Database } from '../../database/database.js';
import { pushSubscriptions } from '../../database/schema/index.js';
import { PUSH_QUEUE, type PushJob } from '../../jobs/push.js';
import { REDIS } from '../../redis/redis.module.js';
import type { AuthContext } from '../auth/index.js';
import { loadVapidKeys } from './vapid.js';

/**
 * Web Push: o navegador se inscreve aqui e cada mensagem nova vira uma tarefa na
 * fila; o worker decide quem deve ser avisado (quem não está com a aba aberta e
 * não silenciou a conversa) e envia.
 */
@Injectable()
export class PushService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(PushService.name);
  private queue?: Queue<PushJob>;
  private publicKey: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: DomainEvents,
  ) {}

  async onModuleInit(): Promise<void> {
    // Inscrições de uma sessão encerrada param de receber.
    this.events.on('session.revoked', ({ sessionIds }) => {
      void this.db
        .delete(pushSubscriptions)
        .where(inArray(pushSubscriptions.sessionId, sessionIds))
        .catch((e: unknown) => this.logger.warn(`Limpeza de inscrições falhou: ${String(e)}`));
    });
    if (!this.config.PUSH_ENABLED) return;
    this.publicKey = (await loadVapidKeys(this.db)).publicKey;
    this.queue = new Queue<PushJob>(PUSH_QUEUE, {
      connection: this.redis.duplicate({ maxRetriesPerRequest: null }),
      defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500, attempts: 2 },
    });
    this.events.on('message.created', ({ message, recipientIds }) => {
      if (message.type !== 'text' || !this.queue) return;
      const userIds = recipientIds.filter((u) => u !== message.senderId);
      if (!userIds.length) return;
      void this.queue
        .add('message', { messageId: message.id, userIds })
        .catch((e: unknown) => this.logger.warn(`Fila de push indisponível: ${String(e)}`));
    });
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
  }

  clientConfig(): PushConfig {
    return { enabled: !!this.publicKey, publicKey: this.publicKey };
  }

  async subscribe(
    auth: AuthContext,
    body: PushSubscriptionRequest,
    userAgent: string | null,
  ): Promise<void> {
    await this.db
      .insert(pushSubscriptions)
      .values({
        userId: auth.user.id,
        sessionId: auth.session.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
      })
      // O mesmo navegador com outra pessoa logada: a inscrição passa a ser dela.
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: auth.user.id,
          sessionId: auth.session.id,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent,
        },
      });
  }

  async unsubscribe(auth: AuthContext, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, auth.user.id)),
      );
  }
}
