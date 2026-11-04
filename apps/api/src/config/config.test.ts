import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  APP_ORIGINS: 'http://chat.orgao.local/, http://localhost:5173',
};

describe('loadConfig', () => {
  it('aplica padrões seguros para HTTP', () => {
    const c = loadConfig(base);
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.APP_ORIGINS).toEqual(['http://chat.orgao.local', 'http://localhost:5173']);
    expect(c.SESSION_IDLE_MINUTES).toBe(480);
  });

  it('tolera .env salvo no Windows (CRLF)', () => {
    const c = loadConfig({ ...base, COOKIE_SECURE: 'false\r', SESSION_MAX_HOURS: '24\r' });
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.SESSION_MAX_HOURS).toBe(24);
  });

  it('explica como corrigir um endereço sem http://', () => {
    expect(() => loadConfig({ ...base, APP_ORIGINS: '192.168.0.10' })).toThrow(/http:\/\//);
  });

  it('explica o que está errado', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://x', APP_ORIGINS: '' })).toThrow(
      /DATABASE_URL[\s\S]*APP_ORIGINS/,
    );
  });
});
