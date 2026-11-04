/** Formato único de erro retornado pela API. */
export interface ApiError {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  /** Erros de validação por campo (caminho → mensagens). */
  fields?: Record<string, string[]>;
  requestId?: string;
}

export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_INACTIVE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_ORIGIN',
  'PASSWORD_CHANGE_REQUIRED',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
