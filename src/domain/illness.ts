/**
 * Possible illness from last night's data, confirmed by asking the athlete
 * (David, 26-11-2026: "use the daily morning questions to confirm whether it
 * can be that or other factors; how the athlete feels is also important").
 *
 * `illnessSignal` compares the night that ends on `date` with the athlete's own
 * baseline; `illnessOutcome` combines it with the answer to the morning
 * check-in question («¿Cómo te encuentras?»). Never a diagnosis: the answer
 * decides what the app suggests. Pure; mirrored to the edge functions (briefing,
 * coach and Claude contexts) by scripts/sync-domain-mirror.mjs.
 *
 * Thresholds [E] = limited evidence, [H] = coaching heuristic (docs/research/02 §0):
 * - Baseline: the MEDIAN of the 14–28 nights before `date` that have the value
 *   (at least 14), so one bad night or a past cold barely moves it. [H]
 * - Respiration during sleep +1 breath/min or more over the baseline. Breathing
 *   rate at night is very stable (night-to-night SD ≈ 0.5); a rise of about one
 *   breath per minute is what wearables saw around the onset of respiratory
 *   infections (Miller et al. 2020, WHOOP; Natarajan et al. 2020, Fitbit). [E]
 * - Heart rate during sleep, or resting heart rate, +5 bpm or more: the classic
 *   "something is going on" signal (research 02 §11.8; Radin et al. 2020 and
 *   Mishra et al. 2020 on illness onset). [E]
 * - HRV 15 % or more below the baseline: supporting evidence only, it also drops
 *   after hard training or a bad night. [H]
 * Level: respiration or heart rate up → 'watch'; both, or one of them with the
 * HRV drop → 'likely'; HRV alone → 'none'.
 */
import { addDays } from './dates';
import type { IllnessAnswer, ISODate } from './types';

export type IllnessLevel = 'none' | 'watch' | 'likely';

/** The metrics this module reads (app and server rows both fit). */
export interface NightMetrics {
  date: ISODate;
  source: string;
  hrvMs?: number | null;
  restingHr?: number | null;
  /** Average breathing rate during the night that ends on `date`, breaths/min. */
  sleepRespiration?: number | null;
  /** Average heart rate during that night, bpm. */
  sleepAvgHr?: number | null;
}

export interface IllnessSignal {
  date: ISODate;
  level: IllnessLevel;
  /** Spanish, one per signal: "Respiración 16,1 resp/min, +1,4 sobre tu media (14,7)". */
  reasons: string[];
  /** Night value minus baseline (null when unknown). */
  respirationDelta: number | null;
  sleepHrDelta: number | null;
  restingHrDelta: number | null;
  /** % below the HRV baseline (positive = lower than usual), null when unknown. */
  hrvDropPct: number | null;
  /** Which signals are up, for the wording of the question. */
  breathingUp: boolean;
  pulseUp: boolean;
}

export const ILLNESS_SIGNAL = {
  baselineMaxNights: 28,
  baselineMinNights: 14,
  respirationRise: 1,
  heartRateRise: 5,
  hrvDropPct: 15,
} as const;

/** Merge priority everywhere: Garmin > COROS > HealthKit > manual. */
const SOURCE_RANK: Readonly<Record<string, number>> = { garmin: 0, coros: 1, healthkit: 2, manual: 3 };

type Key = 'hrvMs' | 'restingHr' | 'sleepRespiration' | 'sleepAvgHr';

/** Plausible ranges (anything else is a sensor glitch). */
const RANGES: Readonly<Record<Key, readonly [number, number]>> = {
  hrvMs: [1, 300],
  restingHr: [25, 120],
  sleepRespiration: [4, 40],
  sleepAvgHr: [25, 150],
};

function valueOn(metrics: readonly NightMetrics[], date: ISODate, key: Key): number | null {
  const rows = metrics.filter((m) => m.date === date).sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9));
  const [min, max] = RANGES[key];
  for (const row of rows) {
    const v = row[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
  }
  return null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/** Median of the nights before `date` (up to 28 back), null with fewer than 14. */
function baseline(metrics: readonly NightMetrics[], date: ISODate, key: Key): number | null {
  const values: number[] = [];
  for (let back = 1; back <= ILLNESS_SIGNAL.baselineMaxNights; back += 1) {
    const v = valueOn(metrics, addDays(date, -back), key);
    if (v !== null) values.push(v);
  }
  return values.length >= ILLNESS_SIGNAL.baselineMinNights ? median(values) : null;
}

interface Compared {
  value: number;
  base: number;
  delta: number;
}

function compare(metrics: readonly NightMetrics[], date: ISODate, key: Key): Compared | null {
  const value = valueOn(metrics, date, key);
  const base = value === null ? null : baseline(metrics, date, key);
  return value === null || base === null ? null : { value, base, delta: value - base };
}

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals).replace('.', ',');
}

/** "59 ppm, +6 sobre tu media (53)": the difference of the numbers as shown, so it adds up. */
function versusBaseline(c: Compared, unit: string, decimals = 0): string {
  const f = 10 ** decimals;
  const shown = (n: number) => Math.round(n * f) / f;
  const delta = shown(c.value) - shown(c.base);
  return `${fmt(c.value, decimals)} ${unit}, +${fmt(delta, decimals)} sobre tu media (${fmt(c.base, decimals)})`;
}

const NONE: Omit<IllnessSignal, 'date'> = {
  level: 'none',
  reasons: [],
  respirationDelta: null,
  sleepHrDelta: null,
  restingHrDelta: null,
  hrvDropPct: null,
  breathingUp: false,
  pulseUp: false,
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

function pulseReasons(sleepHr: Compared | null, rhr: Compared | null): string[] {
  const reasons: string[] = [];
  if (sleepHr && sleepHr.delta >= ILLNESS_SIGNAL.heartRateRise) reasons.push(`Pulso durante el sueño ${versusBaseline(sleepHr, 'ppm')}`);
  if (rhr && rhr.delta >= ILLNESS_SIGNAL.heartRateRise) reasons.push(`Pulso en reposo ${versusBaseline(rhr, 'ppm')}`);
  return reasons;
}

/**
 * Last night (the metrics row of `date`) against the athlete's baseline. Only
 * that night counts: an old row never raises today's question.
 */
export function illnessSignal(metrics: readonly NightMetrics[], date: ISODate): IllnessSignal {
  const breathing = compare(metrics, date, 'sleepRespiration');
  const sleepHr = compare(metrics, date, 'sleepAvgHr');
  const rhr = compare(metrics, date, 'restingHr');
  const hrv = compare(metrics, date, 'hrvMs');
  const breathingUp = breathing !== null && breathing.delta >= ILLNESS_SIGNAL.respirationRise;
  const pulse = pulseReasons(sleepHr, rhr);
  const pulseUp = pulse.length > 0;
  const hrvDropPct = hrv && hrv.base > 0 ? Math.round(((hrv.base - hrv.value) / hrv.base) * 100) : null;
  const hrvDown = hrvDropPct !== null && hrvDropPct >= ILLNESS_SIGNAL.hrvDropPct;
  const primary = Number(breathingUp) + Number(pulseUp);
  const level: IllnessLevel = primary === 0 ? 'none' : primary === 2 || hrvDown ? 'likely' : 'watch';
  if (level === 'none') return { ...NONE, date };
  const reasons = [
    ...(breathing && breathingUp ? [`Respiración durante el sueño ${versusBaseline(breathing, 'resp/min', 1)}`] : []),
    ...pulse,
    ...(hrv && hrvDown ? [`VFC ${fmt(hrv.value)} ms, un ${hrvDropPct} % por debajo de tu media`] : []),
  ];
  return {
    date,
    level,
    reasons,
    respirationDelta: breathing ? round1(breathing.delta) : null,
    sleepHrDelta: sleepHr ? round1(sleepHr.delta) : null,
    restingHrDelta: rhr ? round1(rhr.delta) : null,
    hrvDropPct,
    breathingUp,
    pulseUp,
  };
}

type Ups = Pick<IllnessSignal, 'breathingUp' | 'pulseUp'>;

/** "Tu respiración y tu pulso de esta noche están más altos de lo normal" (after what is up). */
function statement(signal: Ups): string {
  if (signal.breathingUp && !signal.pulseUp) return 'Tu respiración de esta noche está más alta de lo normal';
  if (signal.pulseUp && !signal.breathingUp) return 'Tu pulso de esta noche está más alto de lo normal';
  return 'Tu respiración y tu pulso de esta noche están más altos de lo normal';
}

/** "Respiración y pulso de esta noche altos" (readiness factors, AI contexts). */
function upText(signal: Ups): string {
  if (signal.breathingUp && !signal.pulseUp) return 'Respiración de esta noche alta';
  if (signal.pulseUp && !signal.breathingUp) return 'Pulso de esta noche alto';
  return 'Respiración y pulso de esta noche altos';
}

/** The extra morning check-in question, worded after what is up. */
export function illnessQuestion(signal: Ups): string {
  return `${statement(signal)}. ¿Cómo te encuentras?`;
}

/** The answers, in the order the check-in shows them. */
export const ILLNESS_ANSWER_LABELS: Readonly<Record<IllnessAnswer, string>> = {
  fine: 'Bien, normal',
  symptoms: 'Noto algo: garganta, mocos o cansancio raro',
  alcohol: 'Bebí alcohol o cené tarde',
  heat: 'Calor o mal descanso',
  stress: 'Estrés',
};

export type IllnessOutcomeKind = 'possible_illness' | 'explained' | 'fine' | 'unanswered';

export interface IllnessOutcome {
  kind: IllnessOutcomeKind;
  level: IllnessLevel;
  answer: IllnessAnswer | null;
  /** One whole sentence for the athlete (briefing, coach), with tact and no digits: it can be read aloud. */
  message: string;
  /** Short line for the readiness factors and the AI contexts. */
  factor: string;
  reasons: string[];
}

export const POSSIBLE_ILLNESS_MESSAGE = 'Puede que estés empezando a ponerte malo: hoy mejor suave y vigila cómo evoluciona.';

const CAUSES: Readonly<Record<'alcohol' | 'heat' | 'stress', string>> = {
  alcohol: 'el alcohol o la cena tardía',
  heat: 'el calor o el mal descanso',
  stress: 'el estrés',
};

/**
 * The athlete's answer decides: symptoms → possible illness (go easy, the day
 * turns amber or red); alcohol, heat or stress → explained, no alarm; fine →
 * keep the plan; no answer yet → a gentle heads-up. Null when there is nothing
 * to say (no signal and no answer).
 */
export function illnessOutcome(signal: IllnessSignal, answer: IllnessAnswer | null | undefined): IllnessOutcome | null {
  const base = { level: signal.level, answer: answer ?? null, reasons: signal.reasons };
  if (answer === 'symptoms') {
    const factor = signal.level === 'none' ? 'Notas síntomas: garganta, mocos o cansancio raro' : `${upText(signal)} y notas síntomas`;
    return { ...base, kind: 'possible_illness', message: POSSIBLE_ILLNESS_MESSAGE, factor };
  }
  if (signal.level === 'none') return null;
  if (answer === 'alcohol' || answer === 'heat' || answer === 'stress') {
    const cause = CAUSES[answer];
    return {
      ...base,
      kind: 'explained',
      message: `${statement(signal)}, seguramente por ${cause}: no es para alarmarse.`,
      factor: `${upText(signal)}, seguramente por ${cause}`,
    };
  }
  if (answer === 'fine') {
    return {
      ...base,
      kind: 'fine',
      message: `${statement(signal)}, pero te encuentras bien: sigue el plan y fíjate en si mañana sigue igual.`,
      factor: `${upText(signal)}, pero te encuentras bien`,
    };
  }
  return {
    ...base,
    kind: 'unanswered',
    message: `${statement(signal)}: si notas algo raro, hoy mejor suave.`,
    factor: `${upText(signal)} frente a tu media`,
  };
}
