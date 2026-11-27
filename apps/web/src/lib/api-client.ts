import { PASSWORD_CHANGE_REQUIRED, isApiErrorBody, type ApiErrorBody } from '@app/shared';
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

/** Servidor inalcançável (rede caiu, API desligada) ou fora do ar (502/503/504, ou 5xx sem corpo da API). */
export const SERVER_UNREACHABLE = 'SERVER_UNREACHABLE';
export const SERVER_DOWN = 'SERVER_DOWN';

function serverError(path: string, statusCode: number): ApiError {
  return new ApiError({
    statusCode,
    code: statusCode === 0 ? SERVER_UNREACHABLE : SERVER_DOWN,
    message:
      statusCode === 0
        ? 'Sem conexão com o servidor. Ele pode estar fora do ar ou a internet caiu; tente de novo em instantes.'
        : 'O servidor está fora do ar no momento. Tente de novo em instantes.',
    timestamp: new Date().toISOString(),
    path,
  });
}

/** fetch que transforma a falha de rede (TypeError) em erro legível; o cancelamento segue como está. */
async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw serverError(path, 0);
  }
}

/** Resposta de erro que não veio da API (o proxy ou o balanceador respondeu no lugar dela). */
function isServerDown(res: Response, payload: unknown): boolean {
  return [502, 503, 504].includes(res.status) || (res.status >= 500 && !isApiErrorBody(payload));
}

type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

/**
 * Chamado quando um 401 nao pode ser recuperado pelo refresh (token expirado,
 * revogado ou o servidor nao o reconhece mais). Quem assina — o AuthProvider —
 * derruba o usuario em memoria e a rota protegida leva ao login.
 */
export function onSessionExpired(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function sessionExpired() {
  tokenStorage.clear();
  for (const l of sessionListeners) l();
}

const passwordListeners = new Set<SessionListener>();

/**
 * A API recusou a chamada porque a conta está com senha provisória
 * (PASSWORD_CHANGE_REQUIRED). Acontece quando a sessão já estava aberta
 * quando a conta foi marcada — administrador deu senha nova, carga da lista
 * de funcionários, API atualizada no meio do uso. Quem assina — o
 * AuthProvider — recarrega a conta e a rota protegida leva ao primeiro acesso.
 */
export function onPasswordChangeRequired(listener: SessionListener): () => void {
  passwordListeners.add(listener);
  return () => {
    passwordListeners.delete(listener);
  };
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokenStorage.get()?.refreshToken;
  if (!refreshToken) return false;

  // Varias requisicoes 401 simultaneas compartilham um unico refresh.
  refreshInFlight ??= (async () => {
    try {
      const res = await request('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      // Servidor fora do ar não é sessão vencida: mantém os tokens e avisa; só o "não" da API desloga.
      if (res.status >= 500) throw serverError('/auth/refresh', res.status);
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
    return request(path, {
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

  if (res.status === 401 && !skipAuth) {
    if (await refreshTokens()) res = await send();
    // Sem refresh possivel, ou 401 mesmo depois dele: a sessao acabou. Vale
    // tambem quando outra aba ja limpou os tokens e esta ainda tem o usuario
    // em memoria: sem isto a tela fica viva mostrando "Unauthorized".
    if (res.status === 401) sessionExpired();
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    if (isServerDown(res, payload)) throw serverError(path, res.status);
    if (isApiErrorBody(payload) && payload.code === PASSWORD_CHANGE_REQUIRED) {
      for (const l of passwordListeners) l();
    }
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
  put: <T>(path: string, body?: unknown, o?: RequestOptions) =>
    apiFetch<T>(path, { ...o, method: 'PUT', body }),
  delete: <T>(path: string, o?: RequestOptions) => apiFetch<T>(path, { ...o, method: 'DELETE' }),
};

/**
 * POST que responde em Server-Sent Events (a ia.Transppass). Mesma sessão e
 * mesmo refresh do apiFetch; cada evento `data:` vira uma chamada de onEvent.
 * Resolve quando o servidor encerra; rejeita com ApiError em erro HTTP.
 */
export async function apiEventStream<E>(
  path: string,
  body: unknown,
  handlers: { onEvent: (event: E) => void; signal?: AbortSignal },
): Promise<void> {
  const send = async (): Promise<Response> => {
    const accessToken = tokenStorage.get()?.accessToken;
    return request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  };
  let res = await send();
  if (res.status === 401) {
    if (await refreshTokens()) res = await send();
    if (res.status === 401) sessionExpired();
  }
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null);
    if (isServerDown(res, payload)) throw serverError(path, res.status);
    throw new ApiError(
      isApiErrorBody(payload)
        ? payload
        : { statusCode: res.status, code: 'UNKNOWN', message: 'Falha na comunicacao com o servidor', timestamp: new Date().toISOString(), path },
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          handlers.onEvent(JSON.parse(raw) as E);
        } catch {
          /* linha parcial ou comentário: ignora */
        }
      }
    }
  }
}
