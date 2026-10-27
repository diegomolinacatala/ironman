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

/** True when `timeZone` is an IANA zone this JS engine knows ("Europe/Madrid"). */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at `instant`: wall clock there minus UTC. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'));
  return wall - (instant - (((instant % 1000) + 1000) % 1000));
}

/**
 * Instant of wall-clock `date` + `minutes` in the IANA `timeZone` (the profile's zone),
 * DST-safe. Falls back to the device's local time when the zone is missing or unknown
 * to the engine.
 */
export function zonedDateTime(date: ISODate, minutes: number, timeZone: string | null | undefined): Date {
  if (!isValidTimeZone(timeZone)) return atLocal(date, minutes);
  try {
    const [y, m, d] = date.split('-').map(Number);
    const wallAsUtc = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, Math.floor(minutes / 60), minutes % 60);
    const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
    // Second pass: the offset at the real instant (differs across a DST change).
    const instant = wallAsUtc - zoneOffsetMs(first, timeZone);
    return Number.isFinite(instant) ? new Date(instant) : atLocal(date, minutes);
  } catch {
    return atLocal(date, minutes);
  }
}
