import type { FastifyInstance } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção CSRF complementar ao cookie `SameSite=Strict`: requisições que alteram
 * estado vindas de um navegador precisam ter `Origin` (ou `Referer`) autorizado.
 * Clientes sem navegador (CLI, testes) não enviam esses cabeçalhos e passam.
 */
export function registerOriginCheck(app: FastifyInstance, allowedOrigins: string[]): void {
  const allowed = new Set(allowedOrigins);

  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;

    const origin = req.headers.origin ?? originFromReferer(req.headers.referer);
    const fetchSite = req.headers['sec-fetch-site'];

    const rejected = origin ? !allowed.has(origin) : fetchSite === 'cross-site';

    if (rejected) {
      await reply.status(403).send({
        statusCode: 403,
        code: 'INVALID_ORIGIN',
        message: 'Origem da requisição não autorizada',
        requestId: String(req.id),
      });
    }
  });
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
