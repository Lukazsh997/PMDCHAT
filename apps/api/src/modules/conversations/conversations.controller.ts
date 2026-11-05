import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  addMembersSchema,
  createChannelSchema,
  type ConversationDetail,
  type ConversationSummary,
  createDirectSchema,
  createGroupSchema,
  editMessageSchema,
  markReadSchema,
  type Message,
  type MentionPage,
  type MessagePage,
  reactionSchema,
  type SearchFileHit,
  searchFilesSchema,
  type SearchMessagesPage,
  searchMessagesSchema,
  sendMessageSchema,
  type ThreadPage,
  setMemberRoleSchema,
  updateConversationSchema,
  updateMySettingsSchema,
} from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthContext } from '../auth/index.js';
import { PermissionService, requestGrants } from '../rbac/index.js';
import { ConversationsService } from './conversations.service.js';
import { ChannelsService } from './channels.service.js';
import { MessagesService } from './messages.service.js';
import { SearchService } from './search.service.js';

const id = new ZodPipe(z.uuid());
const pageQuery = z.object({
  before: z.coerce.number().int().min(0).optional(),
  after: z.coerce.number().int().min(0).optional(),
  around: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const mentionsQuery = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

@Controller()
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly permissions: PermissionService,
    private readonly search: SearchService,
    private readonly channels: ChannelsService,
  ) {}

  @Get('conversations')
  list(@CurrentAuth() auth: AuthContext): Promise<ConversationSummary[]> {
    return this.conversations.list(auth.user.id);
  }

  @Post('conversations/direct')
  @HttpCode(200)
  openDirect(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createDirectSchema)) b: { userId: string },
  ): Promise<ConversationSummary> {
    return this.conversations.openDirect(auth, b.userId);
  }

  @Post('conversations/group')
  createGroup(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createGroupSchema)) b: z.output<typeof createGroupSchema>,
  ): Promise<ConversationSummary> {
    return this.conversations.createGroup(auth, b);
  }

  @Get('conversations/:id')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
  ): Promise<ConversationDetail> {
    return this.conversations.detail(auth.user.id, cid);
  }

  @Patch('conversations/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(updateConversationSchema)) b: z.output<typeof updateConversationSchema>,
  ): Promise<ConversationDetail> {
    return this.conversations.update(auth, cid, b);
  }

  @Post('conversations/:id/members')
  @HttpCode(200)
  addMembers(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(addMembersSchema)) b: { userIds: string[] },
  ): Promise<ConversationDetail> {
    return this.conversations.addMembers(auth, cid, b.userIds);
  }

  @Delete('conversations/:id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Param('userId', id) uid: string,
  ): Promise<void> {
    await this.conversations.removeMember(auth, cid, uid);
  }

  @Put('conversations/:id/members/:userId/role')
  setRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Param('userId', id) uid: string,
    @Body(new ZodPipe(setMemberRoleSchema)) b: { role: 'admin' | 'member' },
  ): Promise<ConversationDetail> {
    return this.conversations.setMemberRole(auth, cid, uid, b.role);
  }

  @Patch('conversations/:id/me')
  settings(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(updateMySettingsSchema)) b: z.output<typeof updateMySettingsSchema>,
  ): Promise<ConversationSummary> {
    return this.conversations.updateMySettings(auth.user.id, cid, b);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  async read(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(markReadSchema)) b: { seq: number },
  ): Promise<{ seq: number }> {
    return { seq: await this.conversations.markRead(auth.user.id, cid, b.seq) };
  }

  @Get('conversations/:id/messages')
  messagesPage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>,
  ): Promise<MessagePage> {
    return this.messages.list(auth.user.id, cid, q);
  }

  @Post('conversations/:id/messages')
  async send(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(sendMessageSchema)) b: z.output<typeof sendMessageSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Message> {
    return this.messages.send(auth, cid, b, await requestGrants(req, this.permissions));
  }

  @Get('messages/:id/thread')
  thread(@CurrentAuth() auth: AuthContext, @Param('id', id) mid: string): Promise<ThreadPage> {
    return this.messages.thread(auth.user.id, mid);
  }

  @Put('messages/:id/reactions')
  react(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) mid: string,
    @Body(new ZodPipe(reactionSchema)) b: { emoji: string },
  ): Promise<Message> {
    return this.messages.react(auth, mid, b.emoji, true);
  }

  @Delete('messages/:id/reactions')
  unreact(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) mid: string,
    @Body(new ZodPipe(reactionSchema)) b: { emoji: string },
  ): Promise<Message> {
    return this.messages.react(auth, mid, b.emoji, false);
  }

  @Post('conversations/channel')
  async createChannel(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createChannelSchema)) b: z.output<typeof createChannelSchema>,
    @Req() req: FastifyRequest,
  ): Promise<ConversationSummary> {
    return this.channels.create(auth, await requestGrants(req, this.permissions), b);
  }

  @Get('search/messages')
  searchMessages(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(searchMessagesSchema)) q: z.output<typeof searchMessagesSchema>,
  ): Promise<SearchMessagesPage> {
    return this.search.searchMessages(auth.user.id, q);
  }

  @Get('search/files')
  searchFiles(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(searchFilesSchema)) q: z.output<typeof searchFilesSchema>,
  ): Promise<SearchFileHit[]> {
    return this.search.searchFiles(auth.user.id, q);
  }

  @Get('mentions')
  mentions(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(mentionsQuery)) q: z.infer<typeof mentionsQuery>,
  ): Promise<MentionPage> {
    return this.messages.mentions(auth.user.id, q);
  }

  @Patch('messages/:id')
  async edit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) mid: string,
    @Body(new ZodPipe(editMessageSchema)) b: z.output<typeof editMessageSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Message> {
    return this.messages.edit(auth, mid, b, await requestGrants(req, this.permissions));
  }

  @Delete('messages/:id')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', id) mid: string): Promise<Message> {
    return this.messages.remove(auth, mid);
  }
}
