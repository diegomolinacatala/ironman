/**
 * Small, pure formatting helpers for the account/settings screens (Spanish).
 * Kept free of React/Expo imports so they are unit-testable.
 */
import type { ISODate, ISODateTime, ISOTime } from '@/domain/types';

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'] as const;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseLocalDate(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** "27 oct 2026" (year omitted when it is the current year of `now`). */
export function formatDateShort(date: ISODate, now: Date = new Date()): string {
  const d = parseLocalDate(date);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/**
 * Relative timestamp for "última sincronización" style labels:
 * "hace un momento", "hace 5 min", "hace 3 h", "ayer, 18:30", "27 oct, 18:30".
 */
export function formatRelativeTime(iso: ISODateTime | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Nunca';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Nunca';
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE_MS) return 'hace un momento';
  if (diff < HOUR_MS) return `hace ${Math.floor(diff / MINUTE_MS)} min`;
  const time = `${pad2(then.getHours())}:${pad2(then.getMinutes())}`;
  const sameDay = localISODate(then) === localISODate(now);
  if (sameDay) return `hace ${Math.floor(diff / HOUR_MS)} h`;
  const yesterday = localISODate(new Date(now.getTime() - DAY_MS));
  if (localISODate(then) === yesterday) return `ayer, ${time}`;
  return `${formatDateShort(localISODate(then), now)}, ${time}`;
}

/** Calendar days from `today` until `date` (negative when in the past). */
export function daysUntil(date: ISODate, today: ISODate): number {
  return Math.round((parseLocalDate(date).getTime() - parseLocalDate(today).getTime()) / DAY_MS);
}

/** `today` + n days as ISODate (local calendar). */
export function addDaysISO(today: ISODate, days: number): ISODate {
  const d = parseLocalDate(today);
  d.setDate(d.getDate() + days);
  return localISODate(d);
}

/** https://… → webcal://… (Apple Calendar subscription scheme). */
export function toWebcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, 'webcal://');
}

/** Minutes since midnight → "HH:mm" (wraps around 24 h). */
export function minutesToClock(minutes: number): ISOTime {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

/** "HH:mm" → minutes since midnight; invalid input → `fallback`. */
export function clockToMinutes(time: ISOTime | null | undefined, fallback = 0): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!match) return fallback;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return fallback;
  return h * 60 + m;
}

/** "Hace 3 semanas"-free compact duration: 330 → "5h 30'", 45 → "45'". */
export function formatMinutesCompact(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}'`;
  return m === 0 ? `${h}h` : `${h}h ${m}'`;
}

/** Strips "@", lowercases and removes characters not allowed in usernames. */
export function sanitizeUsername(input: string): string {
  return input
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 24);
}

/** Suggests a username from a display name ("Diego Molina" → "diego.molina"). */
export function suggestUsername(displayName: string): string {
  const base = sanitizeUsername(displayName.trim().replace(/\s+/g, '.'));
  return base.replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');
}

/** Very small email sanity check before calling the auth API. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}
