import { Module } from '@nestjs/common';
import { AvatarService } from './avatar.service.js';
import { ProfileController } from './profile.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [ProfileController],
  providers: [UsersService, AvatarService],
  exports: [UsersService, AvatarService],
})
export class UsersModule {}
