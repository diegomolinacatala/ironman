/**
 * Garmin Connect Personal API client (port of the official Python client,
 * github.com/garmin/connect-personal-api-python, Apache-2.0):
 * - POST /personalapitoken-service/personal-api/personal-api-key/token with
 *   `Authorization: ApiKey <key>` → body is a JWT (expiry in `exp`).
 * - GET <path> with `Authorization: Bearer <jwt>`.
 * Keys and tokens are never logged or included in error messages.
 */
import { jwtExpiration } from '../crypto.ts';

export const GARMIN_BASE_URL = 'https://personal.connectapi.garmin.com';
export const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const TIMEOUT_MS = 20_000;

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export class GarminApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GarminApiError';
    this.status = status;
  }
}

export interface GarminToken {
  accessToken: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

export interface GarminApi {
  exchangeKey(apiKey: string): Promise<GarminToken>;
  get(path: string, token: GarminToken, query?: Record<string, string | number>): Promise<unknown>;
}

async function safeFetch(fetchFn: FetchFn, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GarminApiError(503, 'Garmin no responde ahora mismo.');
  }
}

export function createGarminApi(fetchFn: FetchFn, baseUrl: string = GARMIN_BASE_URL): GarminApi {
  const base = baseUrl.replace(/\/$/, '');
  return {
    async exchangeKey(apiKey) {
      const res = await safeFetch(fetchFn, `${base}${GARMIN_TOKEN_PATH}`, {
        method: 'POST',
        headers: { Accept: '*/*', Authorization: `ApiKey ${apiKey}` },
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new GarminApiError(res.status, `Garmin rechazó la clave (HTTP ${res.status}).`);
      }
      const accessToken = (await res.text()).trim();
      const expiresAt = jwtExpiration(accessToken);
      if (expiresAt === null) throw new GarminApiError(502, 'Garmin no devolvió un token válido.');
      return { accessToken, expiresAt };
    },
    async get(path, token, query) {
      const qs = query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}` : '';
      const res = await safeFetch(fetchFn, `${base}${path}${qs}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token.accessToken}` },
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new GarminApiError(res.status, `Garmin respondió HTTP ${res.status} en ${path}.`);
      }
      const text = await res.text();
      if (!text.trim()) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new GarminApiError(502, `Respuesta de Garmin no válida en ${path}.`);
      }
    },
  };
}
