import { diffDays, formatDayLabel, toISODate } from '@/domain/dates';
import type { ISODateTime } from '@/domain/types';

const MINUTE_MS = 60_000;
const DAYS_AS_RELATIVE = 7;

/** "ahora", "hace 5 min", "hace 3 h", "ayer", "hace 3 días", or a date label ("lun 19 oct"). */
export function relativeTime(iso: ISODateTime, now: Date = new Date()): string {
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return '';
  const minutes = Math.floor((now.getTime() - then.getTime()) / MINUTE_MS);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const today = toISODate(now);
  const day = toISODate(then);
  const days = diffDays(today, day);
  if (days <= 0) return `hace ${Math.floor(minutes / 60)} h`;
  if (days === 1) return 'ayer';
  if (days < DAYS_AS_RELATIVE) return `hace ${days} días`;
  return formatDayLabel(day, today);
}
