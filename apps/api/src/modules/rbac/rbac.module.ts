import { Global, Module } from '@nestjs/common';
import { PermissionService } from './permission.service.js';
import { ScopesController } from './scopes.controller.js';

/** O PermissionGuard é registrado no AuthModule, logo depois do AuthGuard. */
@Global()
@Module({
  controllers: [ScopesController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class RbacModule {}
