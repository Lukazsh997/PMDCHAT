import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Database } from '../../database/database.js';
import { auditLogs } from '../../database/schema/index.js';

/** Ações auditadas. Novas ações entram aqui para manter o catálogo explícito. */
export type AuditAction =
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.logout'
  | 'auth.session_revoked'
  | 'auth.password_changed'
  | 'auth.password_reset'
  | 'user.created';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Grava o evento de auditoria. Uma falha aqui é registrada no log da aplicação,
   * mas não interrompe a operação do usuário.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        action: entry.action,
        actorId: entry.actorId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata ?? null,
      });
    } catch (err) {
      this.logger.error(`Falha ao gravar auditoria ${entry.action}: ${String(err)}`);
    }
  }
}
