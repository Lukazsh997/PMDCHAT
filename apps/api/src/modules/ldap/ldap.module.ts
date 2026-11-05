import { Global, Module } from '@nestjs/common';
import { AuthModule, EXTERNAL_AUTH } from '../auth/index.js';
import { UsersModule } from '../users/index.js';
import { LdapAuthenticator } from './ldap.authenticator.js';
import { LdapController } from './ldap.controller.js';
import { LdapScheduler } from './ldap.scheduler.js';
import { LdapSettingsService } from './ldap-settings.service.js';
import { LdapSyncService } from './ldap-sync.service.js';

/**
 * Integração com o Active Directory. Global para que o AuthService encontre o
 * autenticador externo (EXTERNAL_AUTH) sem que o módulo de autenticação dependa deste.
 */
@Global()
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [LdapController],
  providers: [
    LdapSettingsService,
    LdapSyncService,
    LdapAuthenticator,
    LdapScheduler,
    { provide: EXTERNAL_AUTH, useExisting: LdapAuthenticator },
  ],
  exports: [EXTERNAL_AUTH, LdapSyncService, LdapScheduler],
})
export class LdapModule {}
