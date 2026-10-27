/**
 * Local morning briefing ("Informe de hoy"), used when Claude is not
 * available (demo, AI off, offline fallback): last night's sleep merged from
 * every metrics source (`briefingSleep.ts`), a verdict, a short headline for
 * the widget, a one-sentence sleep summary, a focus tip and a warm Spanish
 * (Spain, tú) `script` for text-to-speech (`briefingScript.ts`). Pure.
 */
import { HRV_HIGH_RATIO, HRV_LOW_RATIO, hrvRatio, isNum, sleepSnapshotFrom, sleepVerdictOf } from './briefingSleep';
import {
  NO_GARMIN,
  NO_SLEEP_YET,
  QUALITY,
  SPORT_SPOKEN,
  composeScript,
  dayPlanOf,
  isDemanding,
  joinEs,
  keySession,
  lowerFirst,
  type DayPlan,
} from './briefingScript';
import { diffDays, formatDuration } from './dates';
import type { Briefing, DailyMetrics, ISODate, Race, SleepSnapshot, SleepVerdict, Workout } from './types';

export { sleepSnapshotFrom, sleepVerdictOf } from './briefingSleep';

export interface BriefingInput {
  date: ISODate;
  /** Athlete's display name (may be empty). */
  name: string;
  /** Recent daily metrics (ideally the last 8 days: last night + the 7-night HRV baseline). */
  metrics: readonly DailyMetrics[];
  todayWorkouts: readonly Workout[];
  tomorrowWorkouts: readonly Workout[];
  /** Next target race (or null). */
  race: Race | null;
  now: Date;
}

const HEADLINE_MAX = 90;
const LONG_SESSION_MIN = 90;

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

function hoursShort(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}'`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function todayHeadline(plan: DayPlan, race: Race | null): string {
  if (plan.kind === 'race') return `Hoy compites: ${race?.name ?? 'tu carrera'}`;
  if (plan.kind === 'rest') return 'Hoy descanso';
  if (plan.kind === 'done') return 'Sesión de hoy hecha';
  const [main, ...rest] = plan.planned;
  if (!main) return 'Hoy descanso';
  const title = lowerFirst(main.title.trim()) || SPORT_SPOKEN[main.sport];
  return `Hoy ${title} ${formatDuration(main.durationMin)}${rest.length > 0 ? ` y ${rest.length} más` : ''}`;
}

function headlineOf(snapshot: SleepSnapshot | null, plan: DayPlan, race: Race | null): string {
  const sleep = snapshot && isNum(snapshot.hours) ? `Dormiste ${hoursShort(snapshot.hours)}` : null;
  return truncate([sleep, todayHeadline(plan, race)].filter(Boolean).join(' · '), HEADLINE_MAX);
}

// ---------------------------------------------------------------------------
// Sleep summary
// ---------------------------------------------------------------------------

const VERDICT_LEAD: Record<SleepVerdict, string> = {
  great: 'Noche excelente',
  good: 'Buena noche',
  fair: 'Noche regular',
  poor: 'Noche floja',
  unknown: 'Tu recuperación',
};

function hrvDetail(s: SleepSnapshot): string | null {
  if (!isNum(s.hrvMs)) return null;
  const ratio = hrvRatio(s);
  const value = `VFC ${Math.round(s.hrvMs)} ms`;
  if (ratio === null || !isNum(s.hrvBaselineMs)) return value;
  const baseline = Math.round(s.hrvBaselineMs);
  if (ratio < HRV_LOW_RATIO) return `${value}, por debajo de tu media (${baseline})`;
  if (ratio > HRV_HIGH_RATIO) return `${value}, por encima de tu media (${baseline})`;
  return `${value}, en tu media`;
}

function sleepSummaryOf(s: SleepSnapshot | null, verdict: SleepVerdict, hasAnyMetrics: boolean): string {
  if (!s) return hasAnyMetrics ? NO_SLEEP_YET : NO_GARMIN;
  const main = [
    isNum(s.hours) ? `${hoursShort(s.hours)} de sueño` : null,
    isNum(s.score) ? `puntuación ${Math.round(s.score)}` : null,
    hrvDetail(s),
  ].filter((p): p is string => p !== null);
  const extra = [
    isNum(s.restingHr) ? `pulso en reposo ${Math.round(s.restingHr)}` : null,
    isNum(s.bodyBattery) ? `Body Battery ${Math.round(s.bodyBattery)}` : null,
  ].filter((p): p is string => p !== null);
  return `${VERDICT_LEAD[verdict]}: ${joinEs(main.length > 0 ? main : extra)}.`;
}

// ---------------------------------------------------------------------------
// Focus tip (also read aloud, so no digits or abbreviations)
// ---------------------------------------------------------------------------

interface FocusContext {
  plan: DayPlan;
  verdict: SleepVerdict;
  daysToRace: number | null;
}

function trainingFocus(main: Workout, verdict: SleepVerdict): string {
  const demanding = isDemanding(main);
  if (verdict === 'poor' && demanding) {
    return 'Has descansado poco: haz la sesión, pero si las piernas no responden bájala a zona dos o acórtala.';
  }
  if (verdict === 'fair' && demanding) {
    return 'Tu noche ha sido regular: calienta con calma y decide sobre la marcha si mantienes la intensidad.';
  }
  if (QUALITY.includes(main.intensity)) {
    return 'Sesión de calidad: llega con hidratos, una tostada con miel o un plátano una o dos horas antes, y calienta bien.';
  }
  if (main.durationMin >= LONG_SESSION_MIN) {
    return 'Sesión larga: llévate agua e hidratos y empieza a tomarlos pronto, cada veinte o treinta minutos.';
  }
  return 'Suave de verdad: tienes que poder hablar durante toda la sesión. Así se construye la base.';
}

function focusOf({ plan, verdict, daysToRace }: FocusContext): string {
  if (plan.kind === 'race') return 'Sal conservador, come y bebe desde el principio y disfruta: el trabajo ya está hecho.';
  if (daysToRace === 1) return 'Mañana compites: hoy solo activación suave, hidratos en cada comida y a la cama pronto.';
  const key = plan.kind === 'train' ? keySession(plan.planned) : null;
  if (key) return trainingFocus(key, verdict);
  if (verdict === 'poor') return 'Esta noche acuéstate un poco antes; una siesta corta de veinte minutos también te ayudará.';
  if (plan.kind === 'done') return 'Sesión hecha: incluye hidratos y proteína en tu próxima comida y estira unos minutos.';
  return 'Día de descanso: muévete suave, bebe agua a lo largo del día y duerme bien para asimilar el trabajo.';
}

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

/** Builds the local ('rules') briefing of `input.date`. */
export function composeBriefing(input: BriefingInput): Briefing {
  const { date, race, now } = input;
  const snapshot = sleepSnapshotFrom(input.metrics, date);
  const verdict = sleepVerdictOf(snapshot);
  const daysToRace = race && race.date >= date ? diffDays(race.date, date) : null;
  const plan = dayPlanOf(input.todayWorkouts, daysToRace === 0);
  const focus = focusOf({ plan, verdict, daysToRace });
  const hasAnyMetrics = input.metrics.length > 0;
  const script = composeScript({
    date,
    name: input.name.trim(),
    now,
    snapshot,
    verdict,
    hasAnyMetrics,
    plan,
    focus,
    tomorrowWorkouts: input.tomorrowWorkouts,
    race,
    daysToRace,
  });
  return {
    date,
    headline: headlineOf(snapshot, plan, race),
    sleepVerdict: verdict,
    sleepSummary: sleepSummaryOf(snapshot, verdict, hasAnyMetrics),
    script,
    focus,
    sleep: snapshot,
    engine: 'rules',
    createdAt: now.toISOString(),
  };
}
