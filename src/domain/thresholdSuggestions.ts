/**
 * Thresholds that update themselves, only with the athlete's OK (David,
 * 26-11-2026). From the last 8 weeks of completed sessions the app may notice
 * that the run threshold pace, the max heart rate or the bike FTP moved; it
 * then SUGGESTS the new value («¿Lo actualizo?») and changes nothing until the
 * athlete taps «Actualizar». «Ahora no» hides that suggestion for 3 weeks.
 *
 * Conservative on purpose ([E] evidence, [H] coaching heuristic):
 * - Run threshold pace: only from sustained hard runs of 20–60 minutes (whole
 *   session, so warm-ups dilute it) whose average HR is ≥ 90 % of LTHR, or
 *   ≥ 85 % of max HR when there is no LTHR (≈ 92-95 % of LTHR) [H]. Each run is
 *   converted to a one-hour pace with Riegel's model, T2 = T1 · (D2/D1)^1.06,
 *   i.e. pace grows with duration^(0.06/1.06) [E]. A run below threshold HR
 *   gives a slower pace than the athlete can hold, so the estimate errs slow.
 *   Only an improvement is suggested: easier data can never prove a decline.
 * - Max HR: the SECOND highest session maximum (two sessions must reach it, so
 *   one optical-sensor spike does not count), only when above the current one. [H]
 * - Bike FTP: only from a recognisable power test (a bike session whose title
 *   or description says "test" or "FTP" with a best 20-minute power): 95 % of
 *   that power (Allen & Coggan) [E]. A test can lower FTP too.
 * - Suggested only when the difference is ≥ 3 % (pace, FTP) or ≥ 3 bpm (max HR).
 *
 * Pure and unit-tested.
 */
import { addDays } from './dates';
import type { ISODate, Thresholds, Workout } from './types';

export type ThresholdField = 'runThresholdPaceSecPerKm' | 'maxHr' | 'ftpW';

export interface ThresholdSuggestion {
  field: ThresholdField;
  /** Current value (null = not set yet). */
  current: number | null;
  suggested: number;
  /** «Tu umbral de carrera parece haber mejorado a 4:32/km (antes 4:40). ¿Lo actualizo?» */
  message: string;
  /** What it is based on: «Por tu carrera del 12 nov: 10,0 km a 4:25/km con 172 ppm de media.» */
  evidence: string;
  /** The session it comes from. */
  workoutId: string;
}

/** «Ahora no»: the date each suggestion was put off (device-local). */
export type ThresholdSnoozes = Partial<Record<ThresholdField, ISODate>>;

export const THRESHOLD_SUGGESTIONS = {
  windowDays: 56,
  snoozeDays: 21,
  runMinMin: 20,
  runMaxMin: 60,
  runMinDistanceM: 3000,
  lthrFraction: 0.9,
  maxHrFraction: 0.85,
  /** Riegel's 1.06 as a pace-vs-duration exponent: 0.06 / 1.06. */
  riegelPaceExponent: 0.06 / 1.06,
  minPaceChange: 0.03,
  minHrChange: 3,
  ftpFromTwentyMin: 0.95,
  minFtpChange: 0.03,
} as const;

const C = THRESHOLD_SUGGESTIONS;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

function dayLabel(date: ISODate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** 272 → "4:32". */
export function formatPaceSec(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function inWindow(w: Workout, today: ISODate): boolean {
  return w.status === 'completed' && w.date <= today && w.date > addDays(today, -C.windowDays);
}

interface RunEffort {
  workout: Workout;
  paceSec: number;
  thresholdPaceSec: number;
  avgHr: number;
  distanceM: number;
}

function hardRun(w: Workout, t: Thresholds): RunEffort | null {
  const c = w.completed;
  if (w.sport !== 'run' || !c) return null;
  const { durationMin, distanceM, avgHr } = c;
  if (!isNum(durationMin) || !isNum(distanceM) || !isNum(avgHr)) return null;
  if (durationMin < C.runMinMin || durationMin > C.runMaxMin || distanceM < C.runMinDistanceM) return null;
  const hardEnough = isNum(t.lthr) ? avgHr >= C.lthrFraction * t.lthr : isNum(t.maxHr) && avgHr >= C.maxHrFraction * t.maxHr;
  if (!hardEnough) return null;
  const paceSec = (durationMin * 60) / (distanceM / 1000);
  if (paceSec < 150 || paceSec > 600) return null;
  const thresholdPaceSec = paceSec * (60 / durationMin) ** C.riegelPaceExponent;
  return { workout: w, paceSec, thresholdPaceSec, avgHr, distanceM };
}

function runSuggestion(workouts: readonly Workout[], t: Thresholds): ThresholdSuggestion | null {
  const best = workouts
    .map((w) => hardRun(w, t))
    .filter((e): e is RunEffort => e !== null)
    .sort((a, b) => a.thresholdPaceSec - b.thresholdPaceSec)[0];
  if (!best) return null;
  const suggested = Math.round(best.thresholdPaceSec);
  const current = isNum(t.runThresholdPaceSecPerKm) ? t.runThresholdPaceSecPerKm : null;
  if (current !== null && suggested > current * (1 - C.minPaceChange)) return null;
  const km = (best.distanceM / 1000).toFixed(1).replace('.', ',');
  return {
    field: 'runThresholdPaceSecPerKm',
    current,
    suggested,
    message:
      current === null
        ? `Tu umbral de carrera parece estar en ${formatPaceSec(suggested)}/km. ¿Lo guardo?`
        : `Tu umbral de carrera parece haber mejorado a ${formatPaceSec(suggested)}/km (antes ${formatPaceSec(current)}). ¿Lo actualizo?`,
    evidence: `Por tu carrera del ${dayLabel(best.workout.date)}: ${km} km a ${formatPaceSec(best.paceSec)}/km con ${Math.round(best.avgHr)} ppm de media.`,
    workoutId: best.workout.id,
  };
}

const latestOf = (ws: readonly Workout[]): ISODate => ws.map((w) => w.date).sort().reverse()[0] ?? '';

function maxHrSuggestion(workouts: readonly Workout[], t: Thresholds): ThresholdSuggestion | null {
  const current = isNum(t.maxHr) ? t.maxHr : null;
  if (current === null) return null;
  const peaks = workouts
    .filter((w) => isNum(w.completed?.maxHr) && (w.completed?.maxHr ?? 0) >= 120 && (w.completed?.maxHr ?? 0) <= 230)
    .sort((a, b) => (b.completed?.maxHr ?? 0) - (a.completed?.maxHr ?? 0));
  const second = peaks[1];
  if (!second) return null;
  const suggested = Math.round(second.completed?.maxHr ?? 0);
  if (suggested < current + C.minHrChange) return null;
  return {
    field: 'maxHr',
    current,
    suggested,
    message: `Tu FC máxima parece ser ${suggested} ppm (antes ${current}). ¿La actualizo?`,
    evidence: `La has alcanzado en al menos dos sesiones de las últimas 8 semanas, la última el ${dayLabel(latestOf(peaks.slice(0, 2)))}.`,
    workoutId: second.id,
  };
}

const TEST_RE = /\b(test|ftp)\b/i;

function ftpSuggestion(workouts: readonly Workout[], t: Thresholds): ThresholdSuggestion | null {
  const test = workouts
    .filter((w) => w.sport === 'bike' && isNum(w.completed?.bestPower20MinW) && TEST_RE.test(`${w.title} ${w.description ?? ''}`))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const best20 = test?.completed?.bestPower20MinW;
  if (!test || !isNum(best20) || best20 < 60 || best20 > 750) return null;
  const suggested = Math.round(best20 * C.ftpFromTwentyMin);
  const current = isNum(t.ftpW) ? t.ftpW : null;
  if (current !== null && Math.abs(suggested - current) < current * C.minFtpChange) return null;
  return {
    field: 'ftpW',
    current,
    suggested,
    message:
      current === null
        ? `Tu test de bici da un FTP de ${suggested} W. ¿Lo guardo?`
        : `Tu test de bici da un FTP de ${suggested} W (antes ${current}). ¿Lo actualizo?`,
    evidence: `Test del ${dayLabel(test.date)}: ${Math.round(best20)} W de media en 20 minutos (el FTP es el 95 %).`,
    workoutId: test.id,
  };
}

function snoozed(field: ThresholdField, snoozes: ThresholdSnoozes, today: ISODate): boolean {
  const on = snoozes[field];
  return Boolean(on) && today < addDays(on as ISODate, C.snoozeDays);
}

/** What the app may suggest today, most useful first (run pace, FTP, max HR). Never applies anything. */
export function thresholdSuggestions(
  thresholds: Thresholds | null | undefined,
  workouts: readonly Workout[],
  today: ISODate,
  snoozes: ThresholdSnoozes = {},
): ThresholdSuggestion[] {
  const t = thresholds ?? {};
  const recent = workouts.filter((w) => inWindow(w, today));
  return [runSuggestion(recent, t), ftpSuggestion(recent, t), maxHrSuggestion(recent, t)].filter(
    (s): s is ThresholdSuggestion => s !== null && !snoozed(s.field, snoozes, today),
  );
}

/** The thresholds after «Actualizar» (the rest untouched). */
export function applyThresholdSuggestion(thresholds: Thresholds | null | undefined, s: Pick<ThresholdSuggestion, 'field' | 'suggested'>): Thresholds {
  return { ...(thresholds ?? {}), [s.field]: s.suggested };
}
