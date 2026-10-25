/**
 * Tiny local-time helpers shared by the integration builders (pure).
 * Calendar maths lives in `@/domain/dates`; these only bridge `Date` objects
 * (device local time) and the domain's ISODate / ISOTime strings.
 */
import type { ISODate, ISOTime } from '@/domain/types';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date of a timestamp. */
export function localDate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local wall-clock time of a timestamp. */
export function localTime(d: Date): ISOTime {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Minutes since midnight of an 'HH:mm' string, or null when invalid. */
export function parseTimeMinutes(time: string | null | undefined): number | null {
  const match = time ? TIME_RE.exec(time) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Local Date for `date` at `minutes` after midnight (DST-safe: built from components). */
export function atLocal(date: ISODate, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

/** Local midnight that starts `date`. */
export function startOfLocalDate(date: ISODate): Date {
  return atLocal(date, 0);
}
