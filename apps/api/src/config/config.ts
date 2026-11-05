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

  /**
   * Chave usada para cifrar dados sensíveis no banco (segredos do MFA). Gerada pelo
   * install.sh. Trocá-la invalida os MFAs já ativados.
   */
  APP_SECRET: z.string().min(32, 'APP_SECRET precisa ter ao menos 32 caracteres').optional(),
  MFA_REQUIRED_FOR_ADMINS: bool.default(true),

  /** Pasta onde os anexos são gravados. */
  FILES_DIR: z.string().default('./data/files'),
  /** Antivírus (clamd). Vazio desativa a verificação. */
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  /** Recusar uploads quando o antivírus estiver fora do ar. */
  CLAMAV_REQUIRED: bool.default(true),

  /** Web Push (notificações com a aba fechada). Precisa de internet até o serviço do Google. */
  PUSH_ENABLED: bool.default(true),
  /** Contato exigido pelo protocolo VAPID (mailto: ou https:). */
  PUSH_SUBJECT: z.string().default('mailto:suporte@plataforma.local'),
  /** Proxy HTTP(S) de saída da rede, se a VM precisar dele para chegar à internet. */
  PUSH_PROXY: z.url().optional(),

  BOOTSTRAP_ADMIN_USERNAME: z.string().default('admin'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Remove espaços e \r finais: um .env salvo no Windows (CRLF) não deve derrubar o sistema.
  // Variáveis vazias (ex.: `CLAMAV_HOST=`) valem como não definidas.
  const clean = Object.fromEntries(
    Object.entries(env)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
      .filter(([, v]) => v !== ''),
  );
  const parsed = configSchema.safeParse(clean);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`,
    );
    throw new Error(`Configuração inválida:\n${lines.join('\n')}`);
  }
  const config = parsed.data;
  if (!config.APP_SECRET) {
    if (config.NODE_ENV === 'production') {
      throw new Error(
        'Configuração inválida:\n  - APP_SECRET: obrigatório em produção. Rode infra/scripts/install.sh para gerá-lo.',
      );
    }
    config.APP_SECRET = 'desenvolvimento-apenas-nao-use-em-producao-0000';
  }
  return config;
}
