/**
 * Calendar step (pure): which device calendars to read as busy time by default.
 */

/** Title of the calendar where we WRITE the workouts (never read back as busy time). */
export const TRAINING_CALENDAR_TITLE = 'Road to Ironman';

/** Calendars that are noise for planning: birthdays, holidays, Siri suggestions. */
const NOISE_RE = /cumplea|birthday|festiv|holiday|feriado|vacaciones escolares|siri/i;

export interface NamedCalendar {
  id: string;
  title: string;
}

/** Every calendar except birthdays/holidays and our own training calendar. */
export function defaultReadCalendarIds(
  calendars: readonly NamedCalendar[],
  ownTitle: string = TRAINING_CALENDAR_TITLE,
): string[] {
  const own = ownTitle.trim().toLowerCase();
  return calendars.filter((c) => c.title.trim().toLowerCase() !== own && !NOISE_RE.test(c.title)).map((c) => c.id);
}

/** Alarm options for the training calendar (minutes before; 0 = none). */
export const ALARM_OPTIONS: readonly { minutes: number; label: string }[] = [
  { minutes: 0, label: 'Sin aviso' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
];

export function alarmLabel(minutes: number): string {
  if (minutes <= 0) return 'sin aviso';
  return minutes === 60 ? 'aviso 1 h antes' : `aviso ${minutes} min antes`;
}
