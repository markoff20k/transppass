import { isApiErrorBody, type ApiErrorBody } from '@app/shared';
import { tokenStorage } from './token-storage';

const BASE_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

export class ApiError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
  }

  /** Erros de validacao por campo, prontos para o react-hook-form. */
  get fields() {
    return this.body.fields;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** Rotas publicas (login/register) nao devem carregar o Authorization. */
  skipAuth?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokenStorage.get()?.refreshToken;
  if (!refreshToken) return false;

  // Varias requisicoes 401 simultaneas compartilham um unico refresh.
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        tokenStorage.clear();
        return false;
      }
      tokenStorage.set(await res.json());
      return true;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuth, headers, ...init } = options;

  const send = async (): Promise<Response> => {
    const accessToken = tokenStorage.get()?.accessToken;
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!skipAuth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  let res = await send();

  if (res.status === 401 && !skipAuth && (await refreshTokens())) {
    res = await send();
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      isApiErrorBody(payload)
        ? payload
        : {
            statusCode: res.status,
            code: 'UNKNOWN',
            message: 'Falha na comunicacao com o servidor',
            timestamp: new Date().toISOString(),
            path,
          },
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, o?: RequestOptions) => apiFetch<T>(path, { ...o, method: 'GET' }),
  post: <T>(path: string, body?: unknown, o?: RequestOptions) =>
    apiFetch<T>(path, { ...o, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, o?: RequestOptions) =>
    apiFetch<T>(path, { ...o, method: 'PATCH', body }),
  delete: <T>(path: string, o?: RequestOptions) => apiFetch<T>(path, { ...o, method: 'DELETE' }),
};
