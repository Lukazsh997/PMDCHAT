import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ConversationsModule } from '../conversations/index.js';
import { UsersModule } from '../users/index.js';
import { RealtimeService } from './realtime.service.js';

@Module({
  imports: [AuthModule, UsersModule, ConversationsModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
