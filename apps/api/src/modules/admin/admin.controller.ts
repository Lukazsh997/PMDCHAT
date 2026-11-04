import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type AdminStats,
  type AdminUser,
  type AdminUserList,
  type AssignRoleRequest,
  assignRoleSchema,
  type AuditPage,
  createUserSchema,
  type CreateUserResponse,
  setUserStatusSchema,
  type UpdateUserRequest,
  updateUserSchema,
  userStatusSchema,
} from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientInfo } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { PermissionService, RequirePermission, requestGrants } from '../rbac/index.js';
import { AdminUsersService } from './admin-users.service.js';
import { AuditQueryService } from './audit-query.service.js';

const uuidParam = new ZodPipe(z.uuid());
const page = z.coerce.number().int().min(1).default(1);

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  orgUnitId: z.uuid().optional(),
  status: userStatusSchema.optional(),
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const auditQuery = z.object({
  action: z.string().max(64).optional(),
  actorId: z.uuid().optional(),
  entityId: z.string().max(64).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page,
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('admin')
@RequirePermission('admin.access')
export class AdminController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly auditQuery: AuditQueryService,
    private readonly permissions: PermissionService,
  ) {}

  @Get('stats')
  stats(): Promise<AdminStats> {
    return this.auditQuery.stats();
  }

  @Get('users')
  @RequirePermission('users.read')
  async listUsers(
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
    @Req() req: FastifyRequest,
  ): Promise<AdminUserList> {
    return this.adminUsers.list(await this.actor(req), q);
  }

  @Get('users/:id')
  @RequirePermission('users.read')
  async getUser(
    @Param('id', uuidParam) id: string,
    @Req() req: FastifyRequest,
  ): Promise<AdminUser> {
    return this.adminUsers.get(await this.actor(req), id);
  }

  @Post('users')
  @RequirePermission('users.manage')
  async createUser(
    @Body(new ZodPipe(createUserSchema)) body: z.output<typeof createUserSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CreateUserResponse> {
    return this.adminUsers.create(await this.actor(req), body);
  }

  @Patch('users/:id')
  @RequirePermission('users.manage')
  async updateUser(
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserRequest,
    @Req() req: FastifyRequest,
  ): Promise<AdminUser> {
    return this.adminUsers.update(await this.actor(req), id, body);
  }

  @Post('users/:id/status')
  @HttpCode(200)
  @RequirePermission('users.manage')
  async setStatus(
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(setUserStatusSchema)) body: z.infer<typeof setUserStatusSchema>,
    @Req() req: FastifyRequest,
  ): Promise<AdminUser> {
    return this.adminUsers.setStatus(await this.actor(req), id, body.status);
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @RequirePermission('users.manage')
  async resetPassword(
    @Param('id', uuidParam) id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ temporaryPassword: string }> {
    return { temporaryPassword: await this.adminUsers.resetPassword(await this.actor(req), id) };
  }

  @Post('users/:id/reset-mfa')
  @HttpCode(204)
  @RequirePermission('users.manage')
  async resetMfa(@Param('id', uuidParam) id: string, @Req() req: FastifyRequest): Promise<void> {
    await this.adminUsers.resetMfa(await this.actor(req), id);
  }

  @Post('users/:id/roles')
  @HttpCode(200)
  @RequirePermission('roles.assign')
  async assignRole(
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(assignRoleSchema)) body: AssignRoleRequest,
    @Req() req: FastifyRequest,
  ): Promise<AdminUser> {
    return this.adminUsers.assignRole(await this.actor(req), id, body);
  }

  @Delete('users/:id/roles/:assignmentId')
  @RequirePermission('roles.assign')
  async removeRole(
    @Param('id', uuidParam) id: string,
    @Param('assignmentId', uuidParam) assignmentId: string,
    @Req() req: FastifyRequest,
  ): Promise<AdminUser> {
    return this.adminUsers.removeRole(await this.actor(req), id, assignmentId);
  }

  @Get('audit')
  @RequirePermission('audit.read')
  audit(@Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>): Promise<AuditPage> {
    return this.auditQuery.list(q);
  }

  private async actor(req: FastifyRequest) {
    return {
      id: req.auth!.user.id,
      grants: await requestGrants(req, this.permissions),
      ...clientInfo(req),
    };
  }
}
