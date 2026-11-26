/**
 * The one adaptation Hoy offers by itself, without the athlete asking: today's hard session when
 * the watch says they are tired and there is no check-in yet (the check-in already offers
 * "Ajustar hoy"), else a key session missed in the last two days. Quiet by design: nothing when a
 * proposal is already waiting, when it was dismissed today, or when there is nothing worth
 * changing. Stress that is costing the athlete sleep (domain/stressSleep.ts) comes right after
 * today's readiness: ease the next days (when there is something to ease) and breathe. Pure.
 */
import { addDays, formatDayLabel } from '@/domain/dates';
import type { Readiness } from '@/domain/readiness';
import { isKeyish } from '@/domain/replanCore';
import type { StressSleepSignal } from '@/domain/stressSleep';
import type { ISODate, Workout } from '@/domain/types';

export type AdaptNudge =
  | { kind: 'readiness'; key: string; level: 'amber' | 'red'; title: string; detail: string; action: string }
  | { kind: 'missed'; key: string; workouts: Workout[]; title: string; detail: string; action: string }
  | {
      kind: 'stress';
      key: string;
      signal: StressSleepSignal;
      title: string;
      detail: string;
      /** «Suavizar estos días», or null when the next days hold nothing worth easing (only breathing then). */
      action: string | null;
    };

export interface AdaptNudgeInput {
  today: ISODate;
  /** Today's readiness from the watch (and the check-in, when there is one). */
  readiness: Readiness | null;
  checkinDone: boolean;
  /** Workouts from a few days back to the end of the coming week. */
  workouts: readonly Workout[];
  pendingProposals: number;
  /** Keys the athlete dismissed today ("Ahora no"). */
  dismissed: readonly string[];
  /** Stress costing sleep, today (null/absent: nothing to say). */
  stressSleep?: StressSleepSignal | null;
}

/** Missed key sessions are offered for this many days back. */
export const MISSED_LOOKBACK_DAYS = 2;

function firstFactor(r: Readiness): string {
  const factor = r.factors[0];
  return factor ? `${factor.charAt(0).toUpperCase()}${factor.slice(1)}. ` : '';
}

function readinessNudge(input: AdaptNudgeInput): AdaptNudge | null {
  const r = input.readiness;
  if (input.checkinDone || !r || (r.level !== 'amber' && r.level !== 'red')) return null;
  const hard = input.workouts.filter((w) => w.date === input.today && w.status === 'planned' && !w.jointSessionId && isKeyish(w));
  const [first] = hard;
  if (!first) return null;
  const level = r.level;
  return {
    kind: 'readiness',
    key: `readiness:${input.today}`,
    level,
    title: level === 'red' ? 'Hoy tu cuerpo pide recuperar' : 'Hoy vas algo justo',
    detail: `${firstFactor(r)}¿Adapto «${first.title}» para que hoy sume sin hundirte?`,
    action: 'Adaptar hoy',
  };
}

/** Sessions of the eased days that the stress re-plan would change (not done, not quedadas). */
function easable(input: AdaptNudgeInput, signal: StressSleepSignal): Workout[] {
  const last = addDays(input.today, Math.max(1, signal.easeDays) - 1);
  return input.workouts.filter((w) => w.status === 'planned' && w.sport !== 'rest' && !w.jointSessionId && w.date >= input.today && w.date <= last);
}

function stressNudge(input: AdaptNudgeInput): AdaptNudge | null {
  const signal = input.stressSleep;
  if (!signal) return null;
  const canEase = easable(input, signal).length > 0;
  const days = signal.easeDays === 3 ? 'los próximos 3 días' : 'hoy y mañana';
  return {
    kind: 'stress',
    key: `stress:${input.today}`,
    signal,
    title: signal.headline,
    detail: canEase
      ? `¿Suavizo ${days}, manteniendo lo clave? Esta noche, acuéstate antes.`
      : 'Tus próximos días ya son suaves. Esta noche, acuéstate antes y prueba a respirar despacio unos minutos.',
    action: canEase ? 'Suavizar' : null,
  };
}

function missedNudge(input: AdaptNudgeInput): AdaptNudge | null {
  const from = addDays(input.today, -MISSED_LOOKBACK_DAYS);
  const missed = input.workouts.filter((w) => w.status === 'planned' && w.date >= from && w.date < input.today && !w.jointSessionId && (w.isKey || isKeyish(w)));
  const [first] = missed;
  if (!first) return null;
  const title =
    missed.length === 1 ? `Te saltaste «${first.title}» (${formatDayLabel(first.date, input.today).toLowerCase()})` : `Te saltaste ${missed.length} sesiones clave`;
  return {
    kind: 'missed',
    key: `missed:${missed.map((w) => w.id).sort().join(',')}`,
    workouts: missed,
    title,
    detail: '¿La recoloco en los próximos días sin cargar de más la semana?',
    action: 'Recolocar',
  };
}

export function adaptNudge(input: AdaptNudgeInput): AdaptNudge | null {
  if (input.pendingProposals > 0) return null;
  // Today first; a dismissed offer leaves room for the next one.
  return [readinessNudge(input), stressNudge(input), missedNudge(input)].find((n): n is AdaptNudge => n !== null && !input.dismissed.includes(n.key)) ?? null;
}
