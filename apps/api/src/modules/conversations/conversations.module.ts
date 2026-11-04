import { Module } from '@nestjs/common';
import { UsersModule } from '../users/index.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [UsersModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, MessagesService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
