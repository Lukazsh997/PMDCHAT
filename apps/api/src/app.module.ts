import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainEventsModule } from './common/events/domain-events.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './modules/admin/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { ConversationsModule } from './modules/conversations/index.js';
import { DirectoryModule } from './modules/directory/index.js';
import { FilesModule } from './modules/files/index.js';
import { HealthModule } from './modules/health/index.js';
import { LdapModule } from './modules/ldap/index.js';
import { OrgModule } from './modules/org/index.js';
import { PushModule } from './modules/push/index.js';
import { RbacModule } from './modules/rbac/index.js';
import { RealtimeModule } from './modules/realtime/index.js';
import { UsersModule } from './modules/users/index.js';
import { RedisModule } from './redis/redis.module.js';

/**
 * Módulo raiz da API. Cada domínio vive em `src/modules/<nome>` e expõe apenas o
 * que está em seu `index.ts` (regra verificada pelo ESLint).
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    DomainEventsModule,
    AuditModule,
    RbacModule,
    UsersModule,
    AuthModule,
    OrgModule,
    DirectoryModule,
    FilesModule,
    ConversationsModule,
    RealtimeModule,
    AdminModule,
    LdapModule,
    PushModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
