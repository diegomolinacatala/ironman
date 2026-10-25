/**
 * Pure helpers for the weekly availability editor (onboarding step 3 and
 * settings/availability). No React imports: unit-tested.
 */
import type { Availability, ISOTime, TrainingWindow, Weekday } from '@/domain/types';

export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export type WindowPresetId = 'morning' | 'midday' | 'evening';

export interface WindowPreset {
  id: WindowPresetId;
  label: string;
  start: ISOTime;
  end: ISOTime;
}

export const WINDOW_PRESETS: readonly WindowPreset[] = [
  { id: 'morning', label: 'Mañana', start: '07:00', end: '08:30' },
  { id: 'midday', label: 'Mediodía', start: '14:00', end: '15:30' },
  { id: 'evening', label: 'Tarde', start: '19:00', end: '21:00' },
];

export const MIN_WEEKLY_HOURS = 2;
export const MAX_WEEKLY_HOURS = 25;
export const WEEKLY_HOURS_STEP = 0.5;

export const DEFAULT_AVAILABILITY: Availability = {
  weeklyHoursTarget: 8,
  restDay: 0,
  longSessionDays: [5, 6],
  windows: [],
  poolDays: [],
};

function sameWindow(a: TrainingWindow, weekday: Weekday, preset: WindowPreset): boolean {
  return a.weekday === weekday && a.start === preset.start && a.end === preset.end;
}

function sortWindows(windows: readonly TrainingWindow[]): TrainingWindow[] {
  return [...windows].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
}

export function hasWindow(windows: readonly TrainingWindow[], weekday: Weekday, preset: WindowPreset): boolean {
  return windows.some((w) => sameWindow(w, weekday, preset));
}

/** Adds or removes the preset window for a weekday (returns a new array). */
export function toggleWindow(
  windows: readonly TrainingWindow[],
  weekday: Weekday,
  preset: WindowPreset,
): TrainingWindow[] {
  if (hasWindow(windows, weekday, preset)) {
    return windows.filter((w) => !sameWindow(w, weekday, preset));
  }
  return sortWindows([...windows, { weekday, start: preset.start, end: preset.end }]);
}

/** Windows that do not match any preset (e.g. written by the coach or Claude): kept untouched. */
export function customWindows(windows: readonly TrainingWindow[]): TrainingWindow[] {
  return windows.filter((w) => !WINDOW_PRESETS.some((p) => sameWindow(w, w.weekday, p)));
}

/** Removes one exact window (returns a new array). */
export function removeWindow(windows: readonly TrainingWindow[], target: TrainingWindow): TrainingWindow[] {
  return windows.filter((w) => !(w.weekday === target.weekday && w.start === target.start && w.end === target.end));
}

/** Applies the same preset set to every weekday (quick fill). */
export function fillWindowsForAllDays(
  windows: readonly TrainingWindow[],
  preset: WindowPreset,
  weekdays: readonly Weekday[] = WEEKDAYS,
): TrainingWindow[] {
  const withoutPreset = windows.filter((w) => !(w.start === preset.start && w.end === preset.end));
  const added = weekdays.map((weekday) => ({ weekday, start: preset.start, end: preset.end }));
  return sortWindows([...withoutPreset, ...added]);
}

export function toggleWeekday(days: readonly Weekday[], day: Weekday): Weekday[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

/** Total minutes covered by the training windows (indicative capacity). */
export function windowsCapacityMinutes(windows: readonly TrainingWindow[]): number {
  return windows.reduce((sum, w) => sum + Math.max(0, minutesOf(w.end) - minutesOf(w.start)), 0);
}

function minutesOf(time: ISOTime): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  return Number.isInteger(rounded) ? `${rounded} h` : `${String(rounded).replace('.', ',')} h`;
}

/** Normalises a possibly partial availability coming from the backend. */
export function normalizeAvailability(value: Partial<Availability> | null | undefined): Availability {
  return {
    weeklyHoursTarget: value?.weeklyHoursTarget ?? DEFAULT_AVAILABILITY.weeklyHoursTarget,
    restDay: value?.restDay === undefined ? DEFAULT_AVAILABILITY.restDay : value.restDay,
    longSessionDays: value?.longSessionDays ?? DEFAULT_AVAILABILITY.longSessionDays,
    windows: value?.windows ?? DEFAULT_AVAILABILITY.windows,
    poolDays: value?.poolDays ?? DEFAULT_AVAILABILITY.poolDays,
  };
}

/** Rest day cannot also be a long-session day: drop it from long days when chosen. */
export function setRestDay(value: Availability, restDay: Weekday | null): Availability {
  return {
    ...value,
    restDay,
    longSessionDays: restDay === null ? value.longSessionDays : value.longSessionDays.filter((d) => d !== restDay),
  };
}
