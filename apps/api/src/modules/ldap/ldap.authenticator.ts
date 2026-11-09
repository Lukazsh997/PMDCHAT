import { Injectable } from '@nestjs/common';
import { type ExternalAuthenticator, ExternalAuthUnavailableError } from '../auth/index.js';
import { DirectoryUnavailableError } from './ldap.gateway.js';
import { LdapSettingsService } from './ldap-settings.service.js';
import { LdapSyncService } from './ldap-sync.service.js';

/** Login com a senha do AD: acha a pessoa pela conta de serviço e entra como ela. */
@Injectable()
export class LdapAuthenticator implements ExternalAuthenticator {
  constructor(
    private readonly settings: LdapSettingsService,
    private readonly sync: LdapSyncService,
  ) {}

  async authenticate(username: string, password: string) {
    const active = await this.settings.activeGateway();
    if (!active) return null;
    try {
      const person = await active.gateway.findPerson(username);
      if (!person) return 'invalid' as const;
      if (!(await active.gateway.verifyPassword(person.dn, password))) return 'invalid' as const;
      // Atualiza nome, lotação e papéis desta pessoa a cada login (ou cria a conta).
      const user = await this.sync.provisionOnLogin(person, active.row);
      if (!user) return person.disabled ? ('invalid' as const) : ('not_provisioned' as const);
      return { userId: user.id };
    } catch (e) {
      if (e instanceof DirectoryUnavailableError) throw new ExternalAuthUnavailableError(e.message);
      throw e;
    }
  }
}
