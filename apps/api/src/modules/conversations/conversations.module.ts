import { Module } from '@nestjs/common';
import { UsersModule } from '../users/index.js';
import { BroadcastsController } from './broadcasts.controller.js';
import { BroadcastsService } from './broadcasts.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { MessagesService } from './messages.service.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [UsersModule],
  controllers: [ConversationsController, BroadcastsController],
  providers: [ConversationsService, MessagesService, BroadcastsService, SearchService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
