import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { ConversationSummary, Message } from '@plataforma/contracts';
import { DOMAIN_EVENTS } from './tokens.js';

/**
 * Eventos de domínio publicados pelos módulos depois que a transação é confirmada.
 * O módulo de tempo real (e, nas próximas fases, notificações e busca) reage a eles
 * sem que os módulos de origem precisem conhecê-los.
 */
export interface DomainEventMap {
  /** Mensagem nova: entregar a cada membro. */
  'message.created': { message: Message; recipientIds: string[] };
  'message.updated': { message: Message; recipientIds: string[] };
  /** Resumo da conversa mudou para estes usuários (nova conversa, membros, nome). */
  'conversation.changed': { summaries: Map<string, ConversationSummary> };
  'conversation.left': { conversationId: string; userIds: string[] };
  'read.updated': { conversationId: string; userId: string; seq: number; recipientIds: string[] };
  'session.revoked': { sessionIds: string[] };
  'user.deactivated': { userId: string };
}

@Injectable()
export class DomainEvents {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEventMap>(event: K, handler: (p: DomainEventMap[K]) => void): void {
    this.emitter.on(event, handler);
  }
}

@Global()
@Module({
  providers: [DomainEvents, { provide: DOMAIN_EVENTS, useExisting: DomainEvents }],
  exports: [DomainEvents, DOMAIN_EVENTS],
})
export class DomainEventsModule {}
