import { Global, Module } from '@nestjs/common';
import { PermissionService } from './permission.service.js';

/** O PermissionGuard é registrado no AuthModule, logo depois do AuthGuard. */
@Global()
@Module({ providers: [PermissionService], exports: [PermissionService] })
export class RbacModule {}
