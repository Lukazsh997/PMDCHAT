import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@plataforma/contracts';

/** Exceção de domínio com código estável, consumido pelo frontend. */
export class AppException extends HttpException {
  constructor(
    statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super({ statusCode, code, message, fields }, statusCode);
  }
}
