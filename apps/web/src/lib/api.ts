import { API_PREFIX, type ApiError, type ApiErrorCode } from '@plataforma/contracts';

/** Erro de uma chamada à API, com o código estável definido nos contratos. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string[]>;

  constructor(body: ApiError) {
    super(body.message);
    this.status = body.statusCode;
    this.code = body.code;
    this.fields = body.fields ?? {};
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError({
      statusCode: 0,
      code: 'INTERNAL_ERROR',
      message: 'Sem conexão com o servidor. Verifique a rede e tente novamente.',
    });
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(
      isApiError(data)
        ? data
        : {
            statusCode: res.status,
            code: 'INTERNAL_ERROR',
            message: 'Erro inesperado no servidor.',
          },
    );
  }
  return data as T;
}

function isApiError(v: unknown): v is ApiError {
  return typeof v === 'object' && v !== null && 'code' in v && 'message' in v;
}
