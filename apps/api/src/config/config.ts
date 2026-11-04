import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

const origin = z
  .string()
  .regex(
    /^https?:\/\/[^/\s]+$/,
    'use o endereço completo com http:// (ex.: http://chat.orgao.local ou http://192.168.0.10)',
  );

/**
 * Variáveis de ambiente validadas na inicialização. Se algo estiver faltando ou
 * inválido, o processo não sobe e informa exatamente o que corrigir.
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().default('0.1.0'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  /** Origens autorizadas a chamar a API pelo navegador (proteção CSRF). */
  APP_ORIGINS: csv.pipe(z.array(origin).min(1, 'Informe ao menos uma origem em APP_ORIGINS')),
  /** Número de proxies confiáveis à frente da API (Nginx = 1). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  /** Ligar somente quando o site estiver em HTTPS. */
  COOKIE_SECURE: bool.default(false),
  SESSION_COOKIE_NAME: z.string().default('plataforma_sid'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(480),
  SESSION_MAX_HOURS: z.coerce.number().int().positive().default(72),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),

  BOOTSTRAP_ADMIN_USERNAME: z.string().default('admin'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Remove espaços e \r finais: um .env salvo no Windows (CRLF) não deve derrubar o sistema.
  const clean = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
  );
  const parsed = configSchema.safeParse(clean);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`,
    );
    throw new Error(`Configuração inválida:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
