/**
 * Minimal app logger. Use instead of console.* so production builds stay quiet
 * and we have one place to plug in crash reporting later.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

function emit(level: Level, message: string, context?: unknown): void {
  if (!isDev && (level === 'debug' || level === 'info')) return;
  const line = `[rebufo] ${message}`;
  /* eslint-disable no-console */
  if (level === 'error') console.error(line, context ?? '');
  else if (level === 'warn') console.warn(line, context ?? '');
  else console.log(line, context ?? '');
  /* eslint-enable no-console */
}

export const logger = {
  debug: (message: string, context?: unknown) => emit('debug', message, context),
  info: (message: string, context?: unknown) => emit('info', message, context),
  warn: (message: string, context?: unknown) => emit('warn', message, context),
  error: (message: string, context?: unknown) => emit('error', message, context),
};

/** Extracts a user-safe message from an unknown error. */
export function errorMessage(error: unknown, fallback = 'Algo ha fallado. Inténtalo de nuevo.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
