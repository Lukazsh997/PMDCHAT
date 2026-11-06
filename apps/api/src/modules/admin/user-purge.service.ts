import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DomainEvents } from '../../common/events/domain-events.js';
import { DB, type Database } from '../../database/database.js';
import { roleAssignments, userCredentials, users } from '../../database/schema/index.js';
import { SessionService } from '../auth/index.js';
import { AvatarService } from '../users/index.js';

/**
 * Exclusão de uma conta (o "Excluir" do painel e a importação da lista de lotação).
 * As mensagens da pessoa ficam, com o nome; login, e-mail, senha, papéis e foto saem,
 * e o login fica livre para outra conta.
 */
@Injectable()
export class UserPurgeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly avatars: AvatarService,
    private readonly events: DomainEvents,
  ) {}

  async purge(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          deletedAt: new Date(),
          status: 'disabled',
          // Libera o login para reuso; "#" nunca é aceito num login, então não colide.
          username: `#excluido-${id}`,
          email: null,
          jobTitle: null,
          externalId: null,
          ldapDn: null,
        })
        .where(eq(users.id, id));
      await tx.delete(roleAssignments).where(eq(roleAssignments.userId, id));
      await tx.delete(userCredentials).where(eq(userCredentials.userId, id));
    });
    await this.sessions.revokeAllForUser(id, 'user_deleted');
    this.events.emit('user.membership_changed', { userId: id });
    await this.avatars.remove(id);
  }
}
