import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { HealthModule } from './modules/health/index.js';
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
    AuditModule,
    UsersModule,
    AuthModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
