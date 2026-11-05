import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import { type PushConfig, pushSubscriptionSchema } from '@plataforma/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientInfo, CurrentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import type { AuthContext } from '../auth/index.js';
import { PushService } from './push.service.js';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  config(): PushConfig {
    return this.push.clientConfig();
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(pushSubscriptionSchema)) body: z.infer<typeof pushSubscriptionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.push.subscribe(auth, body, clientInfo(req).userAgent);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(z.object({ endpoint: z.string().max(2000) }))) body: { endpoint: string },
  ): Promise<void> {
    await this.push.unsubscribe(auth, body.endpoint);
  }
}
