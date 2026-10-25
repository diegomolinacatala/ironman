/**
 * Local-calendar date helpers. ISODate = 'YYYY-MM-DD' in the athlete's local
 * time; we never derive it from `toISOString()` (that is UTC and shifts days).
 * Weeks start on Monday; Weekday 0 = Monday … 6 = Sunday.
 */
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

import type { DateRange, ISODate, ISODateTime, ISOTime, Sport, Weekday } from './types';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;
const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 800;

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

/** True for 'HH:mm' (optionally with seconds). */
export function isISOTime(s: unknown): s is ISOTime {
  return typeof s === 'string' && TIME_RE.test(s);
}

/** Local calendar date of a Date. */
export function toISODate(d: Date): ISODate {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local date. Pass `now` for determinism (tests, server code). */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
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

/** Every date of the inclusive range (empty when `to` < `from`). */
export function daysInRange(range: DateRange): ISODate[] {
  const total = diffDays(range.to, range.from);
  if (total < 0) return [];
  const count = Math.min(total, MAX_RANGE_DAYS) + 1;
  return Array.from({ length: count }, (_, i) => addDays(range.from, i));
}

export function isDateInRange(date: ISODate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Latest / earliest of two ISO dates (string order equals date order). */
export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

/** ISO-8601 week number (weeks start Monday, week 1 contains the first Thursday). */
export function isoWeekNumber(date: ISODate): number {
  const thursday = addDays(date, 3 - weekdayOf(date));
  const { y } = parts(thursday);
  const jan4 = toISODate(new Date(y, 0, 4, 12));
  const week1Monday = startOfWeek(jan4);
  return Math.floor(diffDays(thursday, week1Monday) / 7) + 1;
}

/** 'HH:mm' → minutes since midnight (NaN when malformed). */
export function timeToMinutes(t: ISOTime): number {
  const match = TIME_RE.exec(t);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight → 'HH:mm' (clamped to 00:00..23:59). */
export function minutesToTime(min: number): ISOTime {
  const safe = Number.isFinite(min) ? Math.min(Math.max(Math.round(min), 0), 23 * 60 + 59) : 0;
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

/** Local wall-clock timestamp without offset ('2026-10-27T18:30:00'), parsed as local time. */
export function toLocalDateTime(date: ISODate, time: ISOTime): ISODateTime {
  return `${date.slice(0, 10)}T${minutesToTime(timeToMinutes(time))}:00`;
}

/** Local date + minutes since midnight of a timestamp (offset-aware via Date). */
export function dateTimeParts(iso: ISODateTime): { date: ISODate; minutes: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: toISODate(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

/** "lun 27" */
export function formatDayShort(date: ISODate): string {
  return format(parseISODate(date), 'EEE d', { locale: es });
}

/** "lunes 27 de octubre" */
export function formatDayLong(date: ISODate): string {
  return format(parseISODate(date), "EEEE d 'de' MMMM", { locale: es });
}

/** "lun 27 oct" */
export function formatDayMedium(date: ISODate): string {
  return format(parseISODate(date), 'EEE d MMM', { locale: es });
}

/** "Hoy", "Mañana", "Ayer" or "lun 27 oct". `today` defaults to the current local date. */
export function formatDayLabel(date: ISODate, today: ISODate = todayISO()): string {
  const diff = diffDays(date, today);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return formatDayMedium(date);
}

/** 45 → "45'", 75 → "1h 15'", 120 → "2h". */
export function formatDuration(min: number): string {
  const total = Number.isFinite(min) ? Math.max(0, Math.round(min)) : 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}'`;
  return m === 0 ? `${h}h` : `${h}h ${m}'`;
}

function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Swim "2.500 m"; other sports "42,2 km" (decimal comma, no trailing ",0"). */
export function formatDistance(m: number, sport: Sport): string {
  const meters = Number.isFinite(m) ? Math.max(0, m) : 0;
  if (sport === 'swim') return `${groupThousands(meters)} m`;
  const km = Math.round(meters / 100) / 10;
  const text = Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',');
  return `${text} km`;
}

/** "18:30" or "" when null. */
export function formatTime(t: ISOTime | null): string {
  if (!t) return '';
  const minutes = timeToMinutes(t);
  return Number.isFinite(minutes) ? minutesToTime(minutes) : '';
}

/** "27 oct – 2 nov" (same month: "3 – 9 nov"). */
export function formatWeekRange(weekStart: ISODate): string {
  const { from, to } = weekRange(weekStart);
  const start = parseISODate(from);
  const end = parseISODate(to);
  const endLabel = format(end, 'd MMM', { locale: es });
  if (start.getMonth() === end.getMonth()) return `${start.getDate()} – ${endLabel}`;
  return `${format(start, 'd MMM', { locale: es })} – ${endLabel}`;
}
