import type { FastifyInstance } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção CSRF complementar ao cookie `SameSite=Strict`, no padrão recomendado pela
 * OWASP ("verifying origin with standard headers"): requisições que alteram estado
 * vindas de um navegador só passam se a origem for o próprio sistema.
 *
 * A origem é aceita quando:
 *  - é o mesmo endereço pelo qual o navegador acessou a API (cabeçalho `Host`),
 *    seja pelo nome DNS, pelo IP ou com porta — sem configuração; ou
 *  - está listada em `APP_ORIGINS` (ex.: o servidor de desenvolvimento ou, no futuro,
 *    o cliente desktop).
 *
 * Um site de terceiros não consegue forjar o cabeçalho `Origin`, então continua recusado.
 * Clientes sem navegador (CLI, testes) não enviam esses cabeçalhos e passam.
 */
export function registerOriginCheck(app: FastifyInstance, allowedOrigins: string[]): void {
  const allowed = new Set(allowedOrigins);

  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;

    const origin = req.headers.origin ?? originFromReferer(req.headers.referer);
    const fetchSite = req.headers['sec-fetch-site'];

    const accepted = isAllowedOrigin(origin, req.headers.host, allowed, fetchSite);

    if (!accepted) {
      req.log.warn(
        { origin, host: req.headers.host },
        'Requisição recusada: origem diferente do endereço do sistema e fora de APP_ORIGINS',
      );
      await reply.status(403).send({
        statusCode: 403,
        code: 'INVALID_ORIGIN',
        message: 'Origem da requisição não autorizada',
        requestId: String(req.id),
      });
    }
  });
}

/** Mesma regra para HTTP e para o handshake do tempo real (proteção contra CSWSH). */
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowed: Set<string>,
  fetchSite?: string | string[],
): boolean {
  if (!origin) return fetchSite !== 'cross-site';
  return allowed.has(origin) || hostOf(origin) === host?.toLowerCase();
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return undefined;
  }
}
