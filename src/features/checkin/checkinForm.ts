/** Pure form helpers for the daily check-in (unit-tested). */
import type { CheckinDraft, DailyCheckin, ISODate, Score5 } from '@/domain/types';

export interface CheckinFormState {
  date: ISODate;
  sleepQuality: Score5 | null;
  sleepHours: number;
  fatigue: Score5 | null;
  soreness: Score5 | null;
  stress: Score5 | null;
  motivation: Score5 | null;
  notes: string;
}

export const DEFAULT_SLEEP_HOURS = 7.5;

export function checkinToForm(date: ISODate, existing: DailyCheckin | null, sleepHoursHint: number | null): CheckinFormState {
  return {
    date,
    sleepQuality: existing?.sleepQuality ?? null,
    sleepHours: existing?.sleepHours ?? roundHalf(sleepHoursHint ?? DEFAULT_SLEEP_HOURS),
    fatigue: existing?.fatigue ?? null,
    soreness: existing?.soreness ?? null,
    stress: existing?.stress ?? null,
    motivation: existing?.motivation ?? null,
    notes: existing?.notes ?? '',
  };
}

export function roundHalf(hours: number): number {
  return Math.round(hours * 2) / 2;
}

/** Returns the draft, or null when a score is still unanswered. */
export function formToCheckinDraft(state: CheckinFormState): CheckinDraft | null {
  const { sleepQuality, fatigue, soreness, stress, motivation } = state;
  if (sleepQuality == null || fatigue == null || soreness == null || stress == null || motivation == null) return null;
  const notes = state.notes.trim();
  return {
    date: state.date,
    sleepQuality,
    sleepHours: state.sleepHours,
    fatigue,
    soreness,
    stress,
    motivation,
    notes: notes ? notes : null,
  };
}

/** "7,5 h" */
export function sleepHoursLabel(hours: number): string {
  return `${String(hours).replace('.', ',')} h`;
}
