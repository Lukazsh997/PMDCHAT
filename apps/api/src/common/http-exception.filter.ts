import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@plataforma/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from './app-exception.js';

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Converte qualquer erro no formato único `ApiError`, sem vazar detalhes internos. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let body: ApiError;
    if (exception instanceof AppException) {
      body = {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...(exception.fields ? { fields: exception.fields } : {}),
      };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      body = {
        statusCode: status,
        code: STATUS_CODES[status] ?? 'INTERNAL_ERROR',
        message: status === 404 ? 'Recurso não encontrado' : exception.message,
      };
    } else if (isFastifyError(exception)) {
      const status = exception.statusCode;
      body = {
        statusCode: status,
        code: STATUS_CODES[status] ?? 'INTERNAL_ERROR',
        message: status < 500 ? exception.message : 'Erro interno',
      };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      body = { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Erro interno' };
    }

    body.requestId = String(request.id);
    void reply.status(body.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR).send(body);
  }
}

function isFastifyError(e: unknown): e is Error & { statusCode: number } {
  return (
    e instanceof Error &&
    typeof (e as unknown as { statusCode?: unknown }).statusCode === 'number' &&
    (e as unknown as { statusCode: number }).statusCode >= 400
  );
}
