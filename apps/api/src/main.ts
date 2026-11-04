import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';

async function main(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen({ host: config.HOST, port: config.PORT });
  new Logger('Bootstrap').log(`API ${config.APP_VERSION} ouvindo em ${config.HOST}:${config.PORT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
