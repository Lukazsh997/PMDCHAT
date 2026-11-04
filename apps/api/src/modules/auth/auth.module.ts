import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from '../rbac/index.js';
import { UsersModule } from '../users/index.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    PasswordService,
    SessionService,
    // A ordem importa: primeiro identifica a sessão, depois confere as permissões.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PasswordService, SessionService, MfaService],
})
export class AuthModule {}
