/**
 * Calendar helpers on 'YYYY-MM-DD' strings (no time zone drift: arithmetic is
 * done on UTC midnights) plus Intl-based conversion of instants to a user's
 * local wall clock. Weeks start on Monday; weekday 0 = Monday … 6 = Sunday.
 */
import type { ISODate, ISODateTime, ISOTime } from './types.ts';

export const DEFAULT_TZ = 'Europe/Madrid';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

export const WEEKDAYS_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function toUtcMs(date: ISODate): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Fecha inválida: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromUtcMs(toUtcMs(date) + n * 86_400_000);
}

/** a − b in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUtcMs(a) - toUtcMs(b)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: ISODate): number {
  const sundayBased = new Date(toUtcMs(date)).getUTCDay();
  return (sundayBased + 6) % 7;
}

export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekdayOf(date));
}

export function datesBetween(from: ISODate, to: ISODate): ISODate[] {
  const days = diffDays(to, from);
  return Array.from({ length: Math.max(0, days + 1) }, (_, i) => addDays(from, i));
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** Postgres 'HH:MM:SS' → 'HH:MM'. Returns null for empty/invalid values. */
export function normalizeTime(value: unknown): ISOTime | null {
  if (typeof value !== 'string') return null;
  const m = TIME_RE.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

export function timeToMinutes(t: ISOTime): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): ISOTime {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export interface LocalParts {
  date: ISODate;
  time: ISOTime;
}

/** Converts an instant to the wall-clock date and time of `tz`. */
export function localParts(instant: Date | ISODateTime, tz: string | null | undefined): LocalParts {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function todayIn(tz: string | null | undefined, now: Date): ISODate {
  return localParts(now, tz).date;
}

/** Offset (minutes east of UTC) of `tz` at the given instant. */
export function tzOffsetMinutes(instant: Date, tz: string | null | undefined): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(
    Number(p.date.slice(0, 4)),
    Number(p.date.slice(5, 7)) - 1,
    Number(p.date.slice(8, 10)),
    Number(p.time.slice(0, 2)),
    Number(p.time.slice(3, 5)),
  );
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** Instant (ISO, UTC) for a wall-clock date+time in `tz`. Exact except inside DST gaps. */
export function zonedToUtc(date: ISODate, time: ISOTime, tz: string | null | undefined): ISODateTime {
  const naive = toUtcMs(date) + timeToMinutes(time) * 60_000;
  const offset = tzOffsetMinutes(new Date(naive), tz);
  const guess = naive - offset * 60_000;
  const corrected = tzOffsetMinutes(new Date(guess), tz);
  return new Date(naive - corrected * 60_000).toISOString();
}
