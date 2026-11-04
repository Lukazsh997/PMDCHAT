import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_PREFIX } from '@plataforma/contracts';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import { registerOriginCheck } from './common/origin-check.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { REDIS } from './redis/redis.module.js';

const LOGIN_ROUTE = `${API_PREFIX}/auth/login`;

/** Monta a aplicação HTTP. Usado pelo `main.ts` e pelos testes de ponta a ponta. */
export async function createApp(opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger:
      opts.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
            ],
          },
    // Fastify aceita um número de saltos confiáveis; a tipagem do adaptador não o declara.
    trustProxy: Number(process.env.TRUST_PROXY_HOPS ?? 1) as unknown as boolean,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    bodyLimit: 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger:
      opts.logger === false
        ? false
        : new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
  });

  const config = app.get<AppConfig>(APP_CONFIG);
  const redis = app.get<Redis>(REDIS);
  const fastify = app.getHttpAdapter().getInstance();

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    // O site roda em HTTP nesta fase: HSTS só deve ser ligado junto com o HTTPS.
    hsts: config.COOKIE_SECURE,
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(fastifyRateLimit, {
    redis,
    nameSpace: 'rl:',
    timeWindow: '1 minute',
    keyGenerator: (req) => `${req.ip}:${req.url.startsWith(LOGIN_ROUTE) ? 'login' : 'api'}`,
    max: (req) =>
      req.url.startsWith(LOGIN_ROUTE)
        ? config.LOGIN_RATE_LIMIT_PER_MINUTE
        : config.API_RATE_LIMIT_PER_MINUTE,
    // O erro lançado aqui é convertido no formato ApiError pelo HttpExceptionFilter.
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(
        new Error(`Muitas requisições. Tente novamente em ${Math.ceil(ctx.ttl / 1000)} s.`),
        { statusCode: 429 },
      ),
  });
  registerOriginCheck(fastify, config.APP_ORIGINS);

  app.setGlobalPrefix(API_PREFIX.slice(1));
  app.enableShutdownHooks();
  return app;
}
