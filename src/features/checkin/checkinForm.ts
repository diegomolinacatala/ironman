/** Pure form helpers for the daily check-in (unit-tested). */
import { allAnswered } from '@/domain/habitCatalog';
import type { CheckinDraft, DailyCheckin, HabitAnswers, HabitId, IllnessAnswer, ISODate, Score5 } from '@/domain/types';

export interface CheckinFormState {
  date: ISODate;
  /** The journal's yes/no questions, in the order they are asked. */
  questions: HabitId[];
  habits: HabitAnswers;
  sleepQuality: Score5 | null;
  sleepHours: number;
  fatigue: Score5 | null;
  soreness: Score5 | null;
  stress: Score5 | null;
  motivation: Score5 | null;
  notes: string;
  /** Last night's breathing or pulse is up: the extra question «¿Cómo te encuentras?» is shown (and required). */
  illnessAsked: boolean;
  illnessAnswer: IllnessAnswer | null;
}

export const DEFAULT_SLEEP_HOURS = 7.5;

export function checkinToForm(
  date: ISODate,
  existing: DailyCheckin | null,
  sleepHoursHint: number | null,
  questions: readonly HabitId[],
  illnessAsked = false,
): CheckinFormState {
  const illnessAnswer = existing?.illnessAnswer ?? null;
  return {
    date,
    questions: [...questions],
    habits: { ...(existing?.habits ?? {}) },
    sleepQuality: existing?.sleepQuality ?? null,
    sleepHours: existing?.sleepHours ?? roundHalf(sleepHoursHint ?? DEFAULT_SLEEP_HOURS),
    fatigue: existing?.fatigue ?? null,
    soreness: existing?.soreness ?? null,
    stress: existing?.stress ?? null,
    motivation: existing?.motivation ?? null,
    notes: existing?.notes ?? '',
    // An answer given earlier stays editable even if the signal went away after a later sync.
    illnessAsked: illnessAsked || illnessAnswer !== null,
    illnessAnswer,
  };
}

export function roundHalf(hours: number): number {
  return Math.round(hours * 2) / 2;
}

/** The extra question is shown and still unanswered. */
export function missingIllnessAnswer(state: Pick<CheckinFormState, 'illnessAsked' | 'illnessAnswer'>): boolean {
  return state.illnessAsked && state.illnessAnswer === null;
}

/** How many of the journal questions are answered ("3/5"). */
export function answeredCount(state: Pick<CheckinFormState, 'questions' | 'habits'>): number {
  return state.questions.filter((id) => typeof state.habits[id] === 'boolean').length;
}

/** True when any optional 1–5 scale has a value (the "Más detalle" fold opens with them). */
export function hasScales(state: CheckinFormState): boolean {
  return [state.sleepQuality, state.fatigue, state.soreness, state.stress, state.motivation].some((v) => v !== null);
}

/**
 * Returns the draft, or null while a journal question (or the extra illness question, when
 * shown) is unanswered. The 1–5 scales are optional. Answers to habits that are no longer
 * asked are kept (they still count for "Qué te afecta").
 */
export function formToCheckinDraft(state: CheckinFormState): CheckinDraft | null {
  if (!allAnswered(state.questions, state.habits)) return null;
  if (missingIllnessAnswer(state)) return null;
  const notes = state.notes.trim();
  return {
    date: state.date,
    habits: { ...state.habits },
    sleepQuality: state.sleepQuality,
    sleepHours: state.sleepHours,
    fatigue: state.fatigue,
    soreness: state.soreness,
    stress: state.stress,
    motivation: state.motivation,
    notes: notes ? notes : null,
    // Only when asked: an absent key leaves a stored answer untouched.
    ...(state.illnessAnswer !== null ? { illnessAnswer: state.illnessAnswer } : {}),
  };
}

/** "7,5 h" */
export function sleepHoursLabel(hours: number): string {
  return `${String(hours).replace('.', ',')} h`;
}
