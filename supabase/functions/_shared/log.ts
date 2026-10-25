/**
 * Structured JSON logger for edge functions. Secrets never reach the logs:
 * fields whose name looks sensitive are redacted and string values that look
 * like keys/tokens (rb_…, sb_secret_…, JWTs, Garmin keys) are masked.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type LogSink = (level: LogLevel, line: string) => void;

const SENSITIVE_KEY = /(secret|token|apikey|api_key|authorization|password|jwt|cipher|path|url|cookie)/i;
const SENSITIVE_VALUE = [
  /rb_[0-9a-f]{16,}/gi,
  /sb_(secret|publishable)_[A-Za-z0-9_-]+/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /sk-ant-[A-Za-z0-9_-]+/g,
];

export function maskString(value: string): string {
  return SENSITIVE_VALUE.reduce((acc, re) => acc.replace(re, '[redacted]'), value);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (typeof value === 'string') return maskString(value).slice(0, 2000);
  if (value instanceof Error) return { name: value.name, message: maskString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** Default sink: one JSON line per entry on stderr/stdout (picked up by Supabase logs). */
export const consoleSink: LogSink = (level, line) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
};

export function createLogger(base: LogFields = {}, sink: LogSink = consoleSink): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    const entry = { level, msg: maskString(msg), ts: new Date().toISOString(), ...(redact({ ...base, ...fields }) as LogFields) };
    try {
      sink(level, JSON.stringify(entry));
    } catch {
      // Logging must never break a request.
    }
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}

/** Logger that drops everything (tests). */
export const silentLogger: Logger = createLogger({}, () => undefined);

export function errorInfo(error: unknown): LogFields {
  if (error instanceof Error) return { errorName: error.name, errorMessage: maskString(error.message) };
  return { errorMessage: maskString(String(error)) };
}
