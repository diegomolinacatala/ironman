/**
 * What the check-in result says about today's session: it names the session with its main
 * target ("Carrera · 55' · Z4 · 162–168 ppm") and, on amber or red days, the easier version
 * (the coach's plan B when the session has one, else the same cut the re-planner would make).
 * Pure.
 *
 * Its alternative is the same cut "Ajustar hoy" applies (domain/replanner), so the
 * text always matches what the button does.
 */
import { READINESS_EFFECTS } from '@/domain/constants';
import { formatDuration } from '@/domain/dates';
import { workoutHardPoints } from '@/domain/hardness';
import { sportLabel } from '@/domain/labels';
import type { Readiness } from '@/domain/readiness';
import { isLongWorkout, isQualityWorkout } from '@/domain/replanCore';
import { intensityRank } from '@/domain/restrictions';
import type { ISODate, Intensity, Sport, UUID, Workout } from '@/domain/types';
import { mainTargetLine, type PrescriptionContext } from '@/features/coach/prescriptionContext';

export interface TodaySession {
  id: UUID;
  sport: Sport;
  title: string;
  /** "Carrera · 55' · Z4 · 162–168 ppm". */
  detail: string;
}

export interface TodayAdvice {
  /** The session that matters today; null when nothing is left today (or workouts are unknown). */
  session: TodaySession | null;
  /** One sentence for today; null when there is nothing to add to the readiness text. */
  message: string | null;
  /** The easier version on amber / red days ("Versión suave: 40' en Z2 · 145–151 ppm."). */
  alternative: string | null;
  /** "Ajustar hoy" can change something: amber / red with a session it acts on (or still unknown). */
  canAdjust: boolean;
}

type SessionClass = 'quality' | 'long' | 'easy';
type CareLevel = 'amber' | 'red';

const ROUND_MIN = 5;
const SHORTEST_MIN = 20;
const ZONE_SPORTS: readonly Sport[] = ['swim', 'bike', 'run', 'brick'];

function compareDemand(a: Workout, b: Workout): number {
  return (
    workoutHardPoints(a) - workoutHardPoints(b) ||
    intensityRank(a.intensity) - intensityRank(b.intensity) ||
    a.durationMin - b.durationMin
  );
}

/** Today's most demanding session still to do (hard points, then intensity, then duration). */
export function todaySession(workouts: readonly Workout[], date: ISODate): Workout | null {
  const pending = workouts.filter((w) => w.date === date && w.status === 'planned' && w.sport !== 'rest');
  return pending.reduce<Workout | null>((best, w) => (best === null || compareDemand(w, best) > 0 ? w : best), null);
}

function classOf(w: Workout): SessionClass {
  if (isQualityWorkout(w)) return 'quality';
  return isLongWorkout(w) ? 'long' : 'easy';
}

/** Shorter, rounded to 5', never under 20' unless the session already was. */
function easyMinutes(target: number, original: number): number {
  const rounded = Math.max(SHORTEST_MIN, Math.round(target / ROUND_MIN) * ROUND_MIN);
  return Math.min(original, rounded);
}

function easyTarget(sport: Sport, intensity: Intensity, ctx: PrescriptionContext): string {
  return mainTargetLine({ sport, intensity, steps: [] }, ctx);
}

/** The cut "Ajustar hoy" would make (red: ≤ 45' in Z1; amber: quality ×0.7, long ×0.8, in Z2). */
function computedAlternative(w: Workout, level: CareLevel, ctx: PrescriptionContext): string | null {
  const sport: Sport = w.sport === 'brick' ? 'bike' : w.sport;
  const zones = ZONE_SPORTS.includes(w.sport);
  if (level === 'red') {
    if (!zones) return 'Como mucho, movilidad suave o descanso.';
    const minutes = easyMinutes(Math.min(w.durationMin, READINESS_EFFECTS.redMaxEasyMin), w.durationMin);
    return `Como mucho: ${formatDuration(minutes)} muy suaves en ${easyTarget(sport, 'recovery', ctx)}, o descansa.`;
  }
  const kind = classOf(w);
  if (!zones || kind === 'easy') return null;
  const factor = kind === 'quality' ? READINESS_EFFECTS.amberQualityCut : READINESS_EFFECTS.amberLongCut;
  const minutes = easyMinutes(w.durationMin * factor, w.durationMin);
  return `Versión suave: ${formatDuration(minutes)} en ${easyTarget(sport, 'endurance', ctx)}.`;
}

function alternativeFor(w: Workout, level: CareLevel, ctx: PrescriptionContext): string | null {
  const planB = w.coaching?.planB?.trim();
  return planB ? `Si no es tu día: ${planB}` : computedAlternative(w, level, ctx);
}

const GO_MESSAGE = 'Adelante: hazla tal como está planteada.';

const CARE_MESSAGES: Readonly<Record<CareLevel, Readonly<Record<SessionClass, string>>>> = {
  amber: {
    quality: 'Puedes hacerla, pero sin forzar: si al calentar no te encuentras bien, pasa a la versión suave.',
    long: 'Hoy vas algo justo: acórtala y quédate en Z1–Z2.',
    easy: 'Hazla con calma, en la parte baja de la zona.',
  },
  red: {
    quality: 'Hoy no toca hacerla así: tu cuerpo pide recuperar.',
    long: 'Hoy no toca hacerla así: tu cuerpo pide recuperar.',
    easy: 'Tu cuerpo pide recuperar: como mucho algo muy suave.',
  },
};

function sessionLine(w: Workout, ctx: PrescriptionContext): TodaySession {
  const detail = [sportLabel(w.sport), formatDuration(w.durationMin), mainTargetLine(w, ctx)].filter(Boolean).join(' · ');
  return { id: w.id, sport: w.sport, title: w.title, detail };
}

function isCare(level: Readiness['level']): level is CareLevel {
  return level === 'amber' || level === 'red';
}

function noSessionAdvice(level: Readiness['level']): TodayAdvice {
  const message = isCare(level)
    ? 'Hoy no tienes ningún entreno pendiente: aprovecha para recuperar.'
    : 'Hoy no tienes ningún entreno pendiente.';
  return { session: null, message, alternative: null, canAdjust: false };
}

/**
 * Advice for today after the check-in. `workouts` = the week (or today) as loaded; undefined
 * while unknown (loading or failed): then no session is named and "Ajustar hoy" stays available
 * on amber / red days.
 */
export function todayAdvice(
  readiness: Readiness,
  workouts: readonly Workout[] | undefined,
  date: ISODate,
  ctx: PrescriptionContext,
): TodayAdvice {
  const level = readiness.level;
  if (!workouts) return { session: null, message: null, alternative: null, canAdjust: isCare(level) };
  const w = todaySession(workouts, date);
  if (!w) return noSessionAdvice(level);
  const session = sessionLine(w, ctx);
  if (level === 'unknown') return { session, message: null, alternative: null, canAdjust: false };
  if (level === 'green') return { session, message: GO_MESSAGE, alternative: null, canAdjust: false };
  const kind = classOf(w);
  return {
    session,
    message: CARE_MESSAGES[level][kind],
    alternative: alternativeFor(w, level, ctx),
    // Amber only re-plans quality and long sessions (domain/replanner amberDay); red, any.
    canAdjust: level === 'red' || kind !== 'easy',
  };
}
