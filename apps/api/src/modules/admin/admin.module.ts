import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { OrgModule } from '../org/index.js';
import { UsersModule } from '../users/index.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminController } from './admin.controller.js';
import { AuditQueryService } from './audit-query.service.js';
import { RolesService } from './roles.service.js';
import { UserPurgeService } from './user-purge.service.js';

@Module({
  imports: [AuthModule, OrgModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminUsersService, AuditQueryService, RolesService, UserPurgeService],
  exports: [UserPurgeService],
})
export class AdminModule {}
