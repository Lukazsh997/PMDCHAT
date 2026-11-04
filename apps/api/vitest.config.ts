import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const env = process.env;

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        env.TEST_DATABASE_URL ?? 'postgres://plataforma:plataforma@localhost:5432/plataforma_test',
      REDIS_URL: env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      APP_ORIGINS: 'http://app.test',
      LOG_LEVEL: 'warn',
      LOGIN_RATE_LIMIT_PER_MINUTE: '30',
      TRUST_PROXY_HOPS: '0',
    },
  },
});
