/**
 * «Tu forma de entrenar» (Tú › Tu forma de entrenar): editing helpers and the
 * row subtitle in Tú (pure). The shape and the summary live in
 * `@/domain/trainingPrefs`; what is not set stays «Automático».
 */
import { isISOTime } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import {
  DEFAULT_TRAINING_PREFS,
  FIXED_MAX_MINUTES,
  FIXED_MIN_MINUTES,
  FIXED_TITLE_MAX,
  MAX_FIXED_SESSIONS,
  MAX_SESSIONS,
  PREF_SPORTS,
  isDefaultTrainingPrefs,
  trainingPrefsSummary,
} from '@/domain/trainingPrefs';
import type { FixedWeeklySession, PrefSport, TrainableSport, TrainingPrefs, Weekday } from '@/domain/types';

/** Stepper value for «Automático» (below 0 sessions). */
export const AUTO_COUNT = -1;

/** The sports of «Tu forma de entrenar» the athlete trains (strength included when chosen). */
export function prefSportsOf(sports: readonly TrainableSport[]): PrefSport[] {
  return PREF_SPORTS.filter((s) => sports.includes(s));
}

/** Copy of the stored prefs (or the defaults) to edit. */
export function editablePrefs(prefs: TrainingPrefs | null | undefined): TrainingPrefs {
  const p = prefs ?? DEFAULT_TRAINING_PREFS;
  return {
    sessionsPerWeek: { ...p.sessionsPerWeek },
    preferredDays: Object.fromEntries(Object.entries(p.preferredDays).map(([k, v]) => [k, [...(v ?? [])]])),
    longRideDays: [...p.longRideDays],
    longRunDays: [...p.longRunDays],
    intensityModel: p.intensityModel,
    fixedSessions: p.fixedSessions.map((f) => ({ ...f })),
  };
}

/** The stepper's value: «Automático» (-1) or the number of sessions. */
export function countValue(prefs: TrainingPrefs, sport: PrefSport): number {
  return prefs.sessionsPerWeek[sport] ?? AUTO_COUNT;
}

export function countLabel(value: number): string {
  if (value < 0) return 'Automático';
  if (value === 0) return 'Ninguna';
  return value === 1 ? '1 por semana' : `${value} por semana`;
}

export function maxCount(sport: PrefSport): number {
  return MAX_SESSIONS[sport];
}

export function setCount(prefs: TrainingPrefs, sport: PrefSport, value: number): TrainingPrefs {
  const sessionsPerWeek = { ...prefs.sessionsPerWeek };
  if (value < 0) delete sessionsPerWeek[sport];
  else sessionsPerWeek[sport] = Math.min(value, MAX_SESSIONS[sport]);
  return { ...prefs, sessionsPerWeek };
}

function toggle(list: readonly Weekday[], day: Weekday): Weekday[] {
  return list.includes(day) ? list.filter((d) => d !== day) : [...list, day].sort((a, b) => a - b);
}

export function togglePreferredDay(prefs: TrainingPrefs, sport: PrefSport, day: Weekday): TrainingPrefs {
  const next = toggle(prefs.preferredDays[sport] ?? [], day);
  const preferredDays = { ...prefs.preferredDays };
  if (next.length === 0) delete preferredDays[sport];
  else preferredDays[sport] = next;
  return { ...prefs, preferredDays };
}

export function toggleLongDay(prefs: TrainingPrefs, which: 'longRideDays' | 'longRunDays', day: Weekday): TrainingPrefs {
  return { ...prefs, [which]: toggle(prefs[which], day) };
}

export interface FixedDraft {
  sport: PrefSport;
  weekday: Weekday;
  /** 'HH:MM' or '' (any time). */
  startTime: string;
  durationMin: number;
  title: string;
}

export const EMPTY_FIXED: FixedDraft = { sport: 'swim', weekday: 1, startTime: '', durationMin: 60, title: '' };

/** The error of a fixed-session draft, or null when it can be added. */
export function fixedDraftError(draft: FixedDraft, count: number): string | null {
  if (count >= MAX_FIXED_SESSIONS) return `Como mucho ${MAX_FIXED_SESSIONS} sesiones fijas`;
  const time = draft.startTime.trim();
  if (time !== '' && !isISOTime(time)) return 'Hora inválida (usa HH:mm, por ejemplo 20:00)';
  if (draft.durationMin < FIXED_MIN_MINUTES || draft.durationMin > FIXED_MAX_MINUTES) {
    return `La duración va de ${FIXED_MIN_MINUTES} a ${FIXED_MAX_MINUTES} min`;
  }
  if (draft.title.trim().length > FIXED_TITLE_MAX) return `Nombre: máximo ${FIXED_TITLE_MAX} caracteres`;
  return null;
}

/** Adds the draft (title defaults to the sport, e.g. «Natación»). */
export function addFixed(prefs: TrainingPrefs, draft: FixedDraft): TrainingPrefs {
  const time = draft.startTime.trim();
  const session: FixedWeeklySession = {
    sport: draft.sport,
    weekday: draft.weekday,
    startTime: time === '' ? null : time,
    durationMin: draft.durationMin,
    title: draft.title.trim() || sportLabel(draft.sport),
  };
  const fixedSessions = [...prefs.fixedSessions, session].sort((a, b) => a.weekday - b.weekday || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  return { ...prefs, fixedSessions };
}

export function removeFixed(prefs: TrainingPrefs, index: number): TrainingPrefs {
  return { ...prefs, fixedSessions: prefs.fixedSessions.filter((_, i) => i !== index) };
}

/** What gets saved: null when everything is automático. */
export function prefsToSave(prefs: TrainingPrefs): TrainingPrefs | null {
  return isDefaultTrainingPrefs(prefs) ? null : prefs;
}

/** Tú › Entrenamiento row: «Automático» or the one-line summary. */
export function trainingPrefsSubtitle(prefs: TrainingPrefs | null | undefined): string {
  const summary = trainingPrefsSummary(prefs);
  return summary ? `${summary.charAt(0).toUpperCase()}${summary.slice(1)}` : 'Automático · el plan decide el reparto';
}
