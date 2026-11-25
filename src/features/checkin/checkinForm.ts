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

/** Watch sleep score (0-100) → the 1-5 sleep quality row, so it starts answered. */
export function sleepQualityFromScore(score: number | null | undefined): Score5 | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return null;
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  return 1;
}

export function checkinToForm(
  date: ISODate,
  existing: DailyCheckin | null,
  sleepHoursHint: number | null,
  sleepScoreHint: number | null = null,
): CheckinFormState {
  return {
    date,
    sleepQuality: existing?.sleepQuality ?? sleepQualityFromScore(sleepScoreHint),
    sleepHours: existing?.sleepHours ?? roundHalf(sleepHoursHint ?? DEFAULT_SLEEP_HOURS),
    fatigue: existing?.fatigue ?? null,
    soreness: existing?.soreness ?? null,
    stress: existing?.stress ?? null,
    motivation: existing?.motivation ?? null,
    notes: existing?.notes ?? '',
  };
}

const SCORE_KEYS = ['sleepQuality', 'fatigue', 'soreness', 'stress', 'motivation'] as const;
type ScoreKey = (typeof SCORE_KEYS)[number];
/** "Todo normal": the middle of every scale. */
export const NORMAL_SCORES: Record<ScoreKey, Score5> = { sleepQuality: 3, fatigue: 3, soreness: 3, stress: 3, motivation: 3 };

export function unansweredCount(state: CheckinFormState): number {
  return SCORE_KEYS.filter((k) => state[k] == null).length;
}

/**
 * One-tap answers: fills only the rows still empty (what the watch or the athlete already
 * set stays), from "Todo normal" or from yesterday's check-in.
 */
export function fillUnanswered(state: CheckinFormState, source: Record<ScoreKey, Score5> | DailyCheckin): CheckinFormState {
  const next = { ...state };
  for (const k of SCORE_KEYS) {
    if (next[k] == null) next[k] = source[k];
  }
  return next;
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
