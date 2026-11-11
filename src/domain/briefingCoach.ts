/**
 * What the morning briefing says about today's key session, the way a coach
 * would: the main set, one concrete target in words (ppm, watts or pace for
 * the athlete), how it should feel and the success criterion, plus the focus
 * tip taken from the session's coaching. Everything speakable: no digits,
 * symbols or acronyms. Pure.
 */
import { isNum } from './briefingSleep';
import {
  distanceWords,
  hrRangeWords,
  numberToWords,
  paceRangeWords,
  powerRangeWords,
  rpeWords,
  spokenCopy,
  stepDurationWords,
} from './briefingSpeech';
import type { Intensity, RaceDistance, Sport, Thresholds, Workout, WorkoutStep } from './types';
import { mainSet, stepTargets, zoneSportOf, zoneTargets, type ZoneOptions, type ZoneTargets } from './zones';

export interface CoachSentence {
  text: string;
  /** Optional detail: when the script is over budget, the highest `drop` goes first. */
  drop?: number;
}

/** The athlete's numbers for the spoken targets (both optional). */
export interface SpeechContext {
  thresholds?: Thresholds | null;
  raceDistance?: RaceDistance | null;
}

export const ZONE_SPOKEN: Record<Intensity, string> = {
  recovery: 'en zona uno',
  endurance: 'en zona dos',
  tempo: 'en zona tres',
  threshold: 'en zona cuatro',
  vo2: 'en zona cinco',
  race: 'a ritmo de carrera',
};

/** Strides and pickups: reps of 1' or less adding up to under 15 % of the session. */
const ACCESSORY_MAX_REP_MIN = 1;
const ACCESSORY_SHARE = 0.15;
/** Below 2' per rep the heart rate lags behind: targets by feel. */
const SHORT_REP_MIN = 2;

export function lowerFirst(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function repsOf(step: WorkoutStep): number {
  return step.repeat && step.repeat > 1 ? step.repeat : 1;
}

function stepMinutes(step: WorkoutStep): number {
  return (step.durationMin ?? 0) * repsOf(step);
}

/** The block that defines the session: its main set, unless that is just strides next to a longer block. */
export function dominantStep(w: Workout): WorkoutStep | null {
  const set = mainSet(w.steps, w.intensity)?.step ?? null;
  if (!set || repsOf(set) < 2 || !isNum(set.durationMin) || set.durationMin > ACCESSORY_MAX_REP_MIN) return set;
  if (stepMinutes(set) >= ACCESSORY_SHARE * w.durationMin) return set;
  const others = w.steps.filter((s) => s.kind === 'work' && s !== set);
  return others.reduce<WorkoutStep | null>((best, s) => (best === null || stepMinutes(s) > stepMinutes(best) ? s : best), null) ?? set;
}

function isShortRep(step: WorkoutStep): boolean {
  return repsOf(step) > 1 && isNum(step.durationMin) && step.durationMin < SHORT_REP_MIN;
}

function mainSetSentence(w: Workout, step: WorkoutStep | null): CoachSentence | null {
  if (!step || repsOf(step) < 2) return null;
  const size = isNum(step.durationMin) ? stepDurationWords(step.durationMin) : isNum(step.distanceM) ? distanceWords(step.distanceM, w.sport === 'swim') : null;
  if (!size) return null;
  const zone = step.intensity ? ` ${ZONE_SPOKEN[step.intensity]}` : '';
  return { text: `La parte principal son ${numberToWords(repsOf(step), 'feminine')} series de ${size}${zone}.`, drop: 1 };
}

function primaryWords(t: ZoneTargets, sport: Sport, leg: 'bike' | 'run' | null): string | null {
  const zs = zoneSportOf(sport, leg);
  if (zs === 'bike') return t.power ? powerRangeWords(t.power) : t.hr ? hrRangeWords(t.hr) : null;
  if (zs === 'run') return t.hr ? hrRangeWords(t.hr) : t.pace ? paceRangeWords(t.pace, 'km') : null;
  if (zs === 'swim') return t.pace ? paceRangeWords(t.pace, '100m') : null;
  return null;
}

function targetsOf(w: Workout, step: WorkoutStep | null, ctx: SpeechContext): ZoneTargets {
  const opts: ZoneOptions = { raceDistance: ctx.raceDistance ?? null };
  return step ? stepTargets(step, w, ctx.thresholds ?? null, opts) : zoneTargets(w.sport, w.intensity, ctx.thresholds ?? null, opts);
}

/** "Tu objetivo: entre … pulsaciones, con un esfuerzo de siete a ocho sobre diez." Only with real numbers (or coaching for short reps). */
function targetSentence(w: Workout, step: WorkoutStep | null, ctx: SpeechContext): CoachSentence | null {
  const t = targetsOf(w, step, ctx);
  if (step && isShortRep(step)) return w.coaching ? { text: `Tu objetivo: un ${rpeWords(t.rpe)}, por sensaciones.`, drop: 1 } : null;
  const primary = primaryWords(t, w.sport, step?.leg ?? null);
  return primary ? { text: `Tu objetivo: ${primary}, con un ${rpeWords(t.rpe)}.`, drop: 1 } : null;
}

/** How the main block should feel: its cue, else the zone's sensations (with coaching only). */
function feelSentence(w: Workout, step: WorkoutStep | null, ctx: SpeechContext): CoachSentence | null {
  if (!w.coaching) return null;
  const text = spokenCopy(step?.cue?.trim() || targetsOf(w, step, ctx).feel);
  return text ? { text, drop: 3 } : null;
}

function successSentence(w: Workout): CoachSentence | null {
  const success = w.coaching?.success ? spokenCopy(w.coaching.success) : null;
  return success ? { text: `Sabrás que lo has hecho bien así: ${lowerFirst(success)}`, drop: 2 } : null;
}

/** Main set, target, sensation and success criterion of today's key session (what can be said). */
export function keySessionSentences(w: Workout, ctx: SpeechContext): CoachSentence[] {
  const step = dominantStep(w);
  return [mainSetSentence(w, step), targetSentence(w, step, ctx), feelSentence(w, step, ctx), successSentence(w)].filter(
    (s): s is CoachSentence => s !== null,
  );
}

/** The session's first speakable coaching key, else its main block's cue; null when none can be read aloud. */
export function coachTip(w: Workout): string | null {
  for (const key of w.coaching?.keys ?? []) {
    const spoken = spokenCopy(key);
    if (spoken) return spoken;
  }
  const cue = dominantStep(w)?.cue;
  return cue ? spokenCopy(cue) : null;
}
