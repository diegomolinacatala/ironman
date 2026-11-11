// GENERATED MIRROR of src/domain/dates.ts (subset used by the planning modules) — do not edit here.
// Edit the app file and run `node scripts/sync-domain-mirror.mjs` (checked by mirror.test.ts).
/** Local-calendar date helpers (ISODate = 'YYYY-MM-DD'); weeks start on Monday. */
import type { DateRange, ISODate, Weekday } from './types.ts';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const MS_PER_DAY = 86_400_000;

function pad(n: number, width = 2): string {
  return String(Math.trunc(Math.abs(n))).padStart(width, '0');
}

function parts(s: ISODate): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(s);
  if (!match) throw new RangeError(`Fecha inválida: ${s}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** True for a well-formed, existing calendar date ('2026-02-30' is false). */
export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parts(s);
  const date = new Date(y, m - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Local calendar date of a Date. */
export function toISODate(d: Date): ISODate {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midday of the date (safe across DST changes). Accepts 'YYYY-MM-DD…' prefixes. */
export function parseISODate(s: ISODate): Date {
  const { y, m, d } = parts(s);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(date: ISODate, n: number): ISODate {
  const { y, m, d } = parts(date);
  return toISODate(new Date(y, m - 1, d + Math.trunc(n), 12));
}

/** a − b in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / MS_PER_DAY);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: ISODate): Weekday {
  return ((parseISODate(date).getDay() + 6) % 7) as Weekday;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekdayOf(date));
}

/** Monday..Sunday of the week containing `weekStart` (normalised to Monday). */
export function weekRange(weekStart: ISODate): DateRange {
  const from = startOfWeek(weekStart);
  return { from, to: addDays(from, 6) };
}

/** ISO-8601 week number (weeks start Monday, week 1 contains the first Thursday). */
export function isoWeekNumber(date: ISODate): number {
  const thursday = addDays(date, 3 - weekdayOf(date));
  const { y } = parts(thursday);
  const jan4 = toISODate(new Date(y, 0, 4, 12));
  const week1Monday = startOfWeek(jan4);
  return Math.floor(diffDays(thursday, week1Monday) / 7) + 1;
}
