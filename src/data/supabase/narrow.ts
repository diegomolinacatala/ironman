/**
 * Tiny, dependency-free narrowing helpers for untrusted JSON (jsonb columns,
 * RPC results, edge-function responses). Pure.
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Accepts numbers and numeric strings (Postgres `numeric` may arrive as text). */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function oneOfOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return oneOf(value, allowed) ?? fallback;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Reads `camelKey` or, failing that, `snake_key` from a record. */
export function pick(record: JsonRecord, camelKey: string, snakeKey?: string): unknown {
  if (record[camelKey] !== undefined) return record[camelKey];
  return snakeKey ? record[snakeKey] : undefined;
}

/** Postgres `time` ('HH:MM:SS') → 'HH:mm'. */
export function timeFromDb(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 5) return null;
  return value.slice(0, 5);
}

export function isWeekday(value: unknown): value is 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/** Removes keys whose value is `undefined` (keeps `null`, which clears columns). */
export function compact<T extends JsonRecord>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as Partial<T>;
}
