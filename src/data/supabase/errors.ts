/**
 * Maps Supabase / PostgREST / Auth / Edge Function errors to `RepositoryError`
 * with Spanish user-facing messages. Pure (no I/O) except `functionErrorBody`.
 */
import { RepositoryError, type RepositoryErrorCode } from '../repository';
import { asNumber, asString, isRecord } from './narrow';

export const MESSAGES = {
  forbidden: 'No tienes permiso para hacer esto.',
  conflict: 'Ya existe un registro con esos datos.',
  usernameTaken: 'Ese nombre de usuario ya está cogido.',
  notFound: 'No hemos encontrado lo que buscabas.',
  invalid: 'Algún dato no es válido. Revísalo e inténtalo de nuevo.',
  network: 'Sin conexión. Revisa tu internet e inténtalo de nuevo.',
  notAuthenticated: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  rateLimited: 'Demasiados intentos. Espera un momento y vuelve a probar.',
  unavailable: 'El servicio no está disponible ahora mismo. Inténtalo más tarde.',
  unknown: 'Algo ha fallado. Inténtalo de nuevo.',
} as const;

const NETWORK_RE = /network request failed|failed to fetch|fetcherror|networkerror|load failed|timed? ?out|aborted|econn|enotfound/i;

interface PgLikeError {
  code: string;
  message: string;
  details: string;
  hint: string;
}

/** Codes our SQL raises in `hint` via `private.raise_error(kind, message)`. */
const SERVER_KINDS: readonly RepositoryErrorCode[] = [
  'not_authenticated',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'rate_limited',
];

function asPgError(error: unknown): PgLikeError | null {
  if (!isRecord(error)) return null;
  const code = asString(error.code);
  const message = asString(error.message);
  if (code === null || message === null) return null;
  return { code, message, details: asString(error.details) ?? '', hint: asString(error.hint) ?? '' };
}

/** Errors raised by our RPCs carry the RepositoryErrorCode in `hint` and a Spanish message. */
function byServerKind(pg: PgLikeError): RepositoryError | null {
  const kind = SERVER_KINDS.find((k) => k === pg.hint);
  if (!kind || !pg.message) return null;
  return new RepositoryError(kind, pg.message, pg);
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof RepositoryError) return error.code === 'network';
  if (isRecord(error) && error.name === 'FunctionsFetchError') return true;
  if (isRecord(error) && error.name === 'AuthRetryableFetchError') return true;
  const message = error instanceof Error ? error.message : isRecord(error) ? asString(error.message) : null;
  return message !== null && NETWORK_RE.test(message);
}

function byPgCode(pg: PgLikeError): { code: RepositoryErrorCode; message: string } | null {
  switch (pg.code) {
    case '42501':
    case 'PGRST301':
      return { code: 'forbidden', message: MESSAGES.forbidden };
    case 'PGRST302':
    case 'PGRST303':
      return { code: 'not_authenticated', message: MESSAGES.notAuthenticated };
    case '23505':
      return /username/i.test(`${pg.message} ${pg.details}`)
        ? { code: 'conflict', message: MESSAGES.usernameTaken }
        : { code: 'conflict', message: MESSAGES.conflict };
    case 'P0001':
      return { code: 'validation', message: pg.message || MESSAGES.invalid };
    case 'PGRST116':
    case 'P0002':
      return { code: 'not_found', message: MESSAGES.notFound };
    case '23503':
      return { code: 'not_found', message: 'El elemento relacionado ya no existe.' };
    case '23514':
    case '23502':
    case '22P02':
    case '22007':
    case '22008':
    case '22001':
    case '22023':
      return { code: 'validation', message: MESSAGES.invalid };
    case 'PGRST202':
    case '42883':
    case '42P01':
      return { code: 'unavailable', message: 'El servidor no está actualizado. Avisa a quien gestiona Rebufo.' };
    default:
      return null;
  }
}

/**
 * Converts anything thrown or returned by supabase-js into a RepositoryError.
 * `fallback` is used when nothing more specific can be said.
 */
export function toRepositoryError(error: unknown, fallback: string = MESSAGES.unknown): RepositoryError {
  if (error instanceof RepositoryError) return error;
  if (isNetworkError(error)) return new RepositoryError('network', MESSAGES.network, error);
  const pg = asPgError(error);
  if (pg) {
    const server = byServerKind(pg);
    if (server) return server;
    const mapped = byPgCode(pg);
    if (mapped) return new RepositoryError(mapped.code, mapped.message, error);
  }
  const status = isRecord(error) ? asNumber(error.status) : null;
  if (status !== null) return fromHttpStatus(status, fallback, error);
  return new RepositoryError('unknown', fallback, error);
}

export function fromHttpStatus(status: number, fallback: string, cause?: unknown, serverMessage?: string | null): RepositoryError {
  if (status === 401) return new RepositoryError('not_authenticated', serverMessage || MESSAGES.notAuthenticated, cause);
  if (status === 403) return new RepositoryError('forbidden', serverMessage || MESSAGES.forbidden, cause);
  if (status === 404) return new RepositoryError('not_found', serverMessage || MESSAGES.notFound, cause);
  if (status === 409) return new RepositoryError('conflict', serverMessage || MESSAGES.conflict, cause);
  if (status === 429) return new RepositoryError('rate_limited', serverMessage || MESSAGES.rateLimited, cause);
  if (status === 400 || status === 422) return new RepositoryError('validation', serverMessage || MESSAGES.invalid, cause);
  if (status === 502 || status === 503 || status === 504) {
    return new RepositoryError('unavailable', serverMessage || MESSAGES.unavailable, cause);
  }
  if (status === 0) return new RepositoryError('network', MESSAGES.network, cause);
  return new RepositoryError('unknown', fallback, cause);
}

export interface FunctionErrorInfo {
  status: number | null;
  /** `error` field of the JSON body (e.g. 'ai_unavailable'). */
  errorCode: string | null;
  /** Human message from the body (`message`), if any. */
  message: string | null;
}

interface ResponseLike {
  status: number;
  clone?: () => ResponseLike;
  json?: () => Promise<unknown>;
}

function asResponseLike(value: unknown): ResponseLike | null {
  return isRecord(value) && typeof value.status === 'number' ? (value as unknown as ResponseLike) : null;
}

/** Extracts status + JSON body of a FunctionsHttpError (context is a fetch Response). */
export async function functionErrorInfo(error: unknown): Promise<FunctionErrorInfo> {
  const response = asResponseLike(isRecord(error) ? error.context : null);
  if (!response) return { status: null, errorCode: null, message: null };
  const status = response.status;
  try {
    // Clone so other readers (logging, callers) can still consume the body.
    const readable = typeof response.clone === 'function' ? response.clone() : response;
    const json = typeof readable.json === 'function' ? await readable.json() : null;
    if (!isRecord(json)) return { status, errorCode: null, message: null };
    return { status, errorCode: asString(json.error), message: asString(json.message) };
  } catch {
    return { status, errorCode: null, message: null };
  }
}

/** Converts an edge-function invoke error into a RepositoryError. */
export async function toFunctionError(error: unknown, fallback: string): Promise<RepositoryError> {
  if (isNetworkError(error)) return new RepositoryError('network', MESSAGES.network, error);
  const info = await functionErrorInfo(error);
  if (info.status === null) return toRepositoryError(error, fallback);
  return fromHttpStatus(info.status, fallback, error, info.message);
}
