import { errorMessage } from '@/lib/logger';

const CANCEL_CODES = new Set(['cancelled', 'ERR_REQUEST_CANCELED', 'ERR_CANCELED', 'ERR_REQUEST_CANCELLED']);

function readCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('code' in value)) return null;
  const code = (value as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function readCause(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('cause' in value)) return undefined;
  return (value as { cause: unknown }).cause;
}

/** True when the user dismissed the native Apple sheet (not an error worth showing). */
export function isAuthCancellation(error: unknown): boolean {
  const codes = [readCode(error), readCode(readCause(error))];
  return codes.some((code) => code !== null && CANCEL_CODES.has(code));
}

/** User-facing Spanish message for auth failures. */
export function authErrorMessage(error: unknown, fallback: string): string {
  const code = readCode(error);
  if (code === 'network') return 'Sin conexión. Revisa tu red e inténtalo de nuevo.';
  if (code === 'rate_limited') return 'Demasiados intentos. Espera un minuto y vuelve a probar.';
  return errorMessage(error, fallback);
}
