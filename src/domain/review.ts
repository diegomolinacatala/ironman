/**
 * The coach's verdict on a completed session: plan vs real. The plan is the
 * expected whole-session average HR (`zones.sessionHrRange`) and RPE
 * (`zones.sessionRpe`); the real data is what the athlete or the watch logged
 * (FC media, RPE, sensaciones, duration). Easy sessions done easier are fine;
 * a session that hurt (RPE well above the plan or bad sensations) gets advice
 * for tomorrow. `reviewTrend` closes the loop: easy sessions that keep coming
 * out harder than planned suggest reviewing the zones (never changed by itself).
 * Spanish copy with numbers the way athletes read them. Pure.
 */
import { COMPLIANCE_BANDS } from './constants';
import { addDays } from './dates';
import { feelLabel } from './labels';
import { complianceOf, isUnplanned } from './load';
import { intensityRank } from './restrictions';
import type { ISODate, NumberRange, RaceDistance, Thresholds, Workout } from './types';
import { sessionHrRange, sessionRpe, type ZoneOptions } from './zones';

export type ReviewVerdict = 'on_target' | 'harder' | 'easier' | 'short' | 'long' | 'unknown';

export interface WorkoutReview {
  verdict: ReviewVerdict;
  title: string;
  /** Plan vs real in one or a few short sentences ("FC media 148 ppm, dentro de lo previsto (143–154)."). */
  detail: string;
  /** What to do next (tomorrow, next time); null when there is nothing to add. */
  next: string | null;
  /** Expected average HR of the session, ppm (null without thresholds, or for swim / strength). */
  plannedHr: NumberRange | null;
  /** Expected session RPE (`zones.sessionRpe`). */
  plannedRpe: NumberRange;
}

export interface ReviewOptions {
  /** Target race distance (what "ritmo de carrera" means for race-pace sessions). */
  raceDistance?: RaceDistance | null;
}

/** Average HR within ±4 ppm of the expected range counts as on plan. */
const HR_TOLERANCE = 4;
/** RPE within ±1 of the expected range counts as on plan. */
const RPE_TOLERANCE = 1;
/** RPE this far above the plan's top, or sensations this low, make it a hard day. */
const HARD_DAY_RPE_EXCESS = 2;
const HARD_DAY_FEEL = 2;

type Side = 'below' | 'in' | 'above';

interface Signals {
  hr: Side | null;
  rpe: Side | null;
  duration: 'short' | 'long' | null;
  hardDay: boolean;
}

function side(value: number | undefined, range: NumberRange | null, tolerance: number): Side | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !range) return null;
  if (value > range.max + tolerance) return 'above';
  if (value < range.min - tolerance) return 'below';
  return 'in';
}

function span(r: NumberRange): string {
  return r.min === r.max ? String(r.min) : `${r.min}–${r.max}`;
}

/** Off the planned duration (TrainingPeaks bands: under 80 % or over 120 %), else null. */
function durationSide(w: Workout): 'short' | 'long' | null {
  const done = w.completed?.durationMin;
  if (complianceOf(w, w.date) === 'done' || typeof done !== 'number' || !(done > 0) || !(w.durationMin > 0)) return null;
  const pct = Math.round((done / w.durationMin) * 100);
  if (pct < COMPLIANCE_BANDS.doneMin) return 'short';
  return pct > COMPLIANCE_BANDS.doneMax ? 'long' : null;
}

function decimal(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function signalsOf(w: Workout, plannedHr: NumberRange | null, plannedRpe: NumberRange): Signals {
  const done = w.completed ?? {};
  const rpe = typeof done.rpe === 'number' ? done.rpe : undefined;
  const hardDay = (rpe !== undefined && rpe >= plannedRpe.max + HARD_DAY_RPE_EXCESS) || (done.feel !== undefined && done.feel <= HARD_DAY_FEEL);
  return {
    hr: side(done.avgHr, plannedHr, HR_TOLERANCE),
    rpe: side(rpe, plannedRpe, RPE_TOLERANCE),
    duration: durationSide(w),
    hardDay,
  };
}

const HR_WORDS: Record<Side, string> = { in: 'dentro de lo previsto', above: 'por encima de lo previsto', below: 'por debajo de lo previsto' };
const RPE_WORDS: Record<Side, string> = { in: 'como estaba previsto', above: 'más duro de lo previsto', below: 'más suave de lo previsto' };

/** Sports whose average HR says something about the session (wrist HR in the pool does not). */
const HR_SPORTS: ReadonlySet<Workout['sport']> = new Set(['run', 'bike', 'brick']);

/** "FC media 148 ppm, dentro de lo previsto (145–151)." or, without a plan to compare, "FC media 148 ppm.". */
function hrPart(w: Workout, s: Signals, plannedHr: NumberRange | null): string | null {
  const avgHr = w.completed?.avgHr;
  if (typeof avgHr !== 'number' || !(avgHr > 0)) return null;
  if (s.hr && plannedHr) return `FC media ${Math.round(avgHr)} ppm, ${HR_WORDS[s.hr]} (${span(plannedHr)}).`;
  return HR_SPORTS.has(w.sport) ? `FC media ${Math.round(avgHr)} ppm.` : null;
}

function detailOf(w: Workout, s: Signals, plannedHr: NumberRange | null, plannedRpe: NumberRange): string {
  const done = w.completed ?? {};
  const parts = [
    hrPart(w, s, plannedHr),
    s.rpe ? `RPE ${decimal(done.rpe ?? 0)}, ${RPE_WORDS[s.rpe]} (${span(plannedRpe)}).` : null,
    done.feel ? `Sensaciones: ${feelLabel(done.feel).toLowerCase()}.` : null,
    s.duration && done.durationMin ? `${Math.round(done.durationMin)}' de ${w.durationMin}' previstos.` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : 'Sin pulso, RPE ni sensaciones: anótalos al terminar para que pueda ajustar tu plan.';
}

function isEasySession(w: Workout): boolean {
  return intensityRank(w.intensity) <= intensityRank('endurance') && w.sport !== 'brick';
}

/** Expected RPE of the session (`zones.sessionRpe`: the main set's, never below the time average). */
export function expectedRpe(w: Workout, opts: ZoneOptions = {}): NumberRange {
  return sessionRpe(w, opts);
}

function verdictOf(w: Workout, s: Signals): ReviewVerdict {
  if (s.hardDay || s.hr === 'above' || s.rpe === 'above') return 'harder';
  if (s.duration) return s.duration;
  const easier = s.hr === 'below' || s.rpe === 'below';
  if (easier && !isEasySession(w)) return 'easier';
  if (s.hr || s.rpe || w.completed?.feel) return 'on_target';
  return 'unknown';
}

function titleOf(verdict: ReviewVerdict, w: Workout): string {
  switch (verdict) {
    case 'on_target':
      return isEasySession(w) ? 'Bien hecho: suave de verdad' : 'Sesión clavada';
    case 'harder':
      return 'Más dura de lo previsto';
    case 'easier':
      return 'Más suave de lo previsto';
    case 'short':
      return 'Más corta de lo previsto';
    case 'long':
      return 'Más larga de lo previsto';
    case 'unknown':
      return 'Sesión hecha';
  }
}

function nextOf(verdict: ReviewVerdict, w: Workout, s: Signals, plannedHr: NumberRange | null): string | null {
  if (s.hardDay) return 'Mañana, prioriza recuperar: duerme bien, come hidratos y, si toca calidad, valora cambiarla por algo suave.';
  switch (verdict) {
    case 'harder':
      if (!isEasySession(w)) return 'La próxima vez, empieza en la parte baja del rango: el objetivo es acabar entero, no vaciarte.';
      return plannedHr ? `En los días suaves, frena: si pasas de ${plannedHr.max} ppm, baja el ritmo.` : 'En los días suaves, frena: tienes que poder hablar todo el rato.';
    case 'easier':
      return 'Si te sentías bien, la próxima vez apunta a la parte alta del rango.';
    case 'short':
      return 'Si la cortaste por cansancio, cuéntaselo al coach; si fue por falta de tiempo, no intentes recuperarla.';
    case 'long':
      return 'Ojo con alargar: el plan cuenta con esa duración para que llegues fresco a la siguiente sesión.';
    case 'unknown':
      return 'Al terminar, anota el RPE y las sensaciones: así puedo ajustar tu plan.';
    case 'on_target':
      return null;
  }
}

function unplannedReview(w: Workout, plannedHr: NumberRange | null, plannedRpe: NumberRange): WorkoutReview {
  const done = w.completed ?? {};
  const parts = [
    typeof done.avgHr === 'number' && done.avgHr > 0 ? `FC media ${Math.round(done.avgHr)} ppm.` : null,
    typeof done.rpe === 'number' ? `RPE ${decimal(done.rpe)}.` : null,
    done.feel ? `Sensaciones: ${feelLabel(done.feel).toLowerCase()}.` : null,
  ].filter((p): p is string => p !== null);
  return {
    verdict: 'unknown',
    title: 'Actividad registrada',
    detail: parts.length > 0 ? `Sin sesión planificada con la que compararla. ${parts.join(' ')}` : 'Sin sesión planificada con la que compararla.',
    next: null,
    plannedHr,
    plannedRpe,
  };
}

/** Plan vs real of a completed session, or null for planned and skipped ones. */
export function reviewWorkout(workout: Workout, thresholds?: Thresholds | null, opts: ReviewOptions = {}): WorkoutReview | null {
  if (workout.status !== 'completed' || workout.sport === 'rest') return null;
  const zoneOpts = { raceDistance: opts.raceDistance ?? null };
  const plannedHr = sessionHrRange(workout, thresholds ?? null, zoneOpts);
  const plannedRpe = expectedRpe(workout, zoneOpts);
  if (isUnplanned(workout)) return unplannedReview(workout, plannedHr, plannedRpe);
  const s = signalsOf(workout, plannedHr, plannedRpe);
  const verdict = verdictOf(workout, s);
  return {
    verdict,
    title: titleOf(verdict, workout),
    detail: detailOf(workout, s, plannedHr, plannedRpe),
    next: nextOf(verdict, workout, s, plannedHr),
    plannedHr,
    plannedRpe,
  };
}

// ---------------------------------------------------------------------------
// Trend: easy sessions that keep coming out harder than planned
// ---------------------------------------------------------------------------

/** Sports whose easy sessions are compared: average HR for run and bike, RPE for all three. */
export const TREND_SPORTS = ['run', 'bike', 'swim'] as const;
export type TrendSport = (typeof TREND_SPORTS)[number];
/** The last easy sessions compared (with HR or RPE to compare)… */
export const TREND_WINDOW = 4;
/** …how many of them must have come out harder than planned… */
export const TREND_MIN_HARDER = 3;
/** …and how far back they may be (older ones say little about today's zones). */
export const TREND_DAYS = 42;

export type TrendSignal = 'hr' | 'rpe' | 'both';

export interface ReviewTrend {
  sport: TrendSport;
  /** Easy sessions compared (newest first, at most TREND_WINDOW). */
  sessions: number;
  /** How many of them came out harder than planned. */
  harder: number;
  /** What showed it: average HR above the zone, RPE above the plan, or both. */
  signal: TrendSignal;
  /** Date of the newest session compared. */
  lastDate: ISODate;
  /** «Tus rodajes suaves van más duros de lo previsto: ¿revisamos tus zonas?» */
  message: string;
  /** «3 de tus últimos 4 rodajes suaves, con el pulso medio por encima de tu zona.» */
  detail: string;
  /** What reviewing means: update the thresholds if they changed, else go easier. */
  advice: string;
}

export interface ReviewTrendOptions extends ReviewOptions {
  today: ISODate;
}

const TREND_COPY: Readonly<Record<TrendSport, { message: string; noun: string; last: string }>> = {
  run: { message: 'Tus rodajes suaves van más duros de lo previsto: ¿revisamos tus zonas?', noun: 'rodajes suaves', last: 'últimos' },
  bike: {
    message: 'Tus salidas suaves en bici van más duras de lo previsto: ¿revisamos tus zonas?',
    noun: 'salidas suaves en bici',
    last: 'últimas',
  },
  swim: { message: 'Tus nados suaves van más duros de lo previsto: ¿revisamos tus zonas?', noun: 'nados suaves', last: 'últimos' },
};

const SIGNAL_TEXT: Readonly<Record<TrendSignal, string>> = {
  hr: 'con el pulso medio por encima de tu zona',
  rpe: 'con un esfuerzo (RPE) por encima de lo previsto',
  both: 'con el pulso o el esfuerzo por encima de lo previsto',
};

const ADVICE: Readonly<Record<TrendSignal, string>> = {
  hr: 'Si tu pulso de umbral ha cambiado, actualízalo; si no, frena un poco en los días suaves.',
  rpe: 'Si tus umbrales ya no son los de ahora, actualízalos; si no, frena un poco en los días suaves.',
  both: 'Si tus umbrales ya no son los de ahora, actualízalos; si no, frena un poco en los días suaves.',
};

interface EasyCheck {
  date: ISODate;
  hr: boolean;
  rpe: boolean;
}

/** An easy session against its plan (HR above the zone, RPE above the plan); null with nothing to compare. */
function easyCheck(w: Workout, thresholds: Thresholds | null | undefined, opts: ZoneOptions): EasyCheck | null {
  const done = w.completed ?? {};
  const hr = side(done.avgHr, sessionHrRange(w, thresholds ?? null, opts), HR_TOLERANCE);
  const rpe = side(typeof done.rpe === 'number' ? done.rpe : undefined, expectedRpe(w, opts), RPE_TOLERANCE);
  if (hr === null && rpe === null) return null;
  return { date: w.date, hr: hr === 'above', rpe: rpe === 'above' };
}

function newestFirst(a: Workout, b: Workout): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.startTime ?? '').localeCompare(a.startTime ?? '');
}

function trendOf(sport: TrendSport, workouts: readonly Workout[], thresholds: Thresholds | null | undefined, opts: ReviewTrendOptions): ReviewTrend | null {
  const from = addDays(opts.today, -TREND_DAYS);
  const zoneOpts = { raceDistance: opts.raceDistance ?? null };
  const checks = workouts
    .filter((w) => w.sport === sport && w.status === 'completed' && w.date >= from && w.date <= opts.today)
    .filter((w) => !isUnplanned(w) && isEasySession(w))
    .sort(newestFirst)
    .map((w) => easyCheck(w, thresholds, zoneOpts))
    .filter((c): c is EasyCheck => c !== null)
    .slice(0, TREND_WINDOW);
  const harder = checks.filter((c) => c.hr || c.rpe);
  if (harder.length < TREND_MIN_HARDER) return null;
  const byHr = harder.some((c) => c.hr);
  const byRpe = harder.some((c) => c.rpe);
  const signal: TrendSignal = byHr && byRpe ? 'both' : byHr ? 'hr' : 'rpe';
  const copy = TREND_COPY[sport];
  // «3 de tus últimos 4 rodajes suaves, …» or, when all of them, «Tus últimas 3 salidas suaves en bici, …».
  const scope = `${copy.last} ${checks.length} ${copy.noun}, ${SIGNAL_TEXT[signal]}.`;
  return {
    sport,
    sessions: checks.length,
    harder: harder.length,
    signal,
    lastDate: checks[0]?.date ?? opts.today,
    message: copy.message,
    detail: harder.length === checks.length ? `Tus ${scope}` : `${harder.length} de tus ${scope}`,
    advice: ADVICE[signal],
  };
}

/**
 * When ≥ 3 of the last 4 easy (Z1–Z2) sessions of a sport came out harder than planned
 * (average HR above the zone, or RPE above the plan) the zones may be off: a suggestion
 * to review them (run first, then bike, then swim). Bad sensations alone do not count
 * (that is fatigue, not zones). Null when there is nothing to suggest.
 */
export function reviewTrend(workouts: readonly Workout[], thresholds: Thresholds | null | undefined, opts: ReviewTrendOptions): ReviewTrend | null {
  for (const sport of TREND_SPORTS) {
    const trend = trendOf(sport, workouts, thresholds, opts);
    if (trend) return trend;
  }
  return null;
}
