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

/** Upload com progresso (fetch ainda não informa progresso de envio). */
export function uploadFile<T>(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_PREFIX}${path}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* resposta sem corpo */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else
        reject(
          new ApiRequestError(
            isApiError(data)
              ? data
              : {
                  statusCode: xhr.status,
                  code: 'INTERNAL_ERROR',
                  message:
                    xhr.status === 413 ? 'Arquivo grande demais.' : 'Falha ao enviar o arquivo.',
                },
          ),
        );
    };
    xhr.onerror = () =>
      reject(
        new ApiRequestError({
          statusCode: 0,
          code: 'INTERNAL_ERROR',
          message: 'Sem conexão com o servidor.',
        }),
      );
    xhr.onabort = () => reject(new DOMException('cancelado', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
