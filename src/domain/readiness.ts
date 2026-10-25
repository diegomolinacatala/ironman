/**
 * Morning readiness traffic light (docs/research/02 §11.8): Garmin/HealthKit
 * metrics + subjective check-in. Missing signals are ignored, never invented.
 */
import { READINESS } from './constants';
import { addDays } from './dates';
import type { DailyCheckin, DailyMetrics, ISODate, MetricsSource } from './types';

export type ReadinessLevel = 'green' | 'amber' | 'red' | 'unknown';

export interface Readiness {
  /** 0-100, null when there is no data at all. */
  score: number | null;
  level: ReadinessLevel;
  /** Spanish, e.g. "VFC 12 % bajo tu media". */
  factors: string[];
  recommendation: string;
}

export interface ReadinessInput {
  today: ISODate;
  checkin: DailyCheckin | null;
  /** Last ~28 days of metrics (any source). */
  metrics: DailyMetrics[];
}

type MetricKey = 'hrvMs' | 'restingHr' | 'sleepHours' | 'sleepScore' | 'trainingReadiness' | 'bodyBattery' | 'stressAvg';

const SOURCE_RANK: Record<MetricsSource, number> = { garmin: 0, healthkit: 1, manual: 2 };
const BASELINE_DAYS = 30;

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals).replace('.', ',');
}

/** First non-null value of `key` on `date`, preferring Garmin > HealthKit > manual. */
function metricOn(metrics: readonly DailyMetrics[], date: ISODate, key: MetricKey): number | null {
  const sameDay = metrics.filter((m) => m.date === date).sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  for (const m of sameDay) {
    const v = m[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function seriesBefore(metrics: readonly DailyMetrics[], today: ISODate, key: MetricKey, days: number): number[] {
  const from = addDays(today, -days);
  const dates = [...new Set(metrics.filter((m) => m.date >= from && m.date < today).map((m) => m.date))].sort();
  return dates.map((d) => metricOn(metrics, d, key)).filter((v): v is number => v !== null);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? null);
}

function meanSd(values: readonly number[]): { mean: number; sd: number } | null {
  if (values.length === 0) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

interface Signals {
  red: string[];
  /** §11.8 amber signals: 2 or more make the day amber, 1 is a note. */
  amber: string[];
  /** Rules that make the day amber on their own (SL2, §11.7). */
  amberRules: string[];
  notes: string[];
  hasData: boolean;
  garminScore: number | null;
}

const EMPTY: Signals = { red: [], amber: [], amberRules: [], notes: [], hasData: false, garminScore: null };

function merge(a: Signals, b: Signals): Signals {
  return {
    red: [...a.red, ...b.red],
    amber: [...a.amber, ...b.amber],
    amberRules: [...a.amberRules, ...b.amberRules],
    notes: [...a.notes, ...b.notes],
    hasData: a.hasData || b.hasData,
    garminScore: a.garminScore ?? b.garminScore,
  };
}

function restingHrSignals(metrics: readonly DailyMetrics[], today: ISODate): Signals {
  const rhr = metricOn(metrics, today, 'restingHr');
  if (rhr === null) return EMPTY;
  const history = seriesBefore(metrics, today, 'restingHr', BASELINE_DAYS);
  const base = history.length >= READINESS.minBaselineDays ? median(history) : null;
  if (base === null) return { ...EMPTY, hasData: true };
  const delta = rhr - base;
  const prev = metricOn(metrics, addDays(today, -1), 'restingHr');
  const prevDelta = prev === null ? 0 : prev - base;
  const text = `FC en reposo +${fmt(delta)} lpm sobre tu media`;
  if (delta >= READINESS.rhrRed || (delta >= READINESS.rhrAmber && prevDelta >= READINESS.rhrAmber)) {
    return { ...EMPTY, hasData: true, red: [text] };
  }
  if (delta >= READINESS.rhrAmber) return { ...EMPTY, hasData: true, amber: [text] };
  return { ...EMPTY, hasData: true };
}

function hrvSignals(metrics: readonly DailyMetrics[], today: ISODate): Signals {
  const todayHrv = metricOn(metrics, today, 'hrvMs');
  if (todayHrv === null || todayHrv <= 0) return EMPTY;
  const history = seriesBefore(metrics, today, 'hrvMs', BASELINE_DAYS + 30).filter((v) => v > 0);
  const stats = history.length >= READINESS.minBaselineDays ? meanSd(history.map(Math.log)) : null;
  if (!stats) return { ...EMPTY, hasData: true };
  const last7 = [...seriesBefore(metrics, today, 'hrvMs', 6).filter((v) => v > 0), todayHrv];
  const roll7 = last7.reduce((s, v) => s + Math.log(v), 0) / last7.length;
  const below = roll7 < stats.mean - READINESS.hrvSwcSd * stats.sd;
  if (!below) return { ...EMPTY, hasData: true };
  const pct = Math.round((1 - Math.exp(roll7 - stats.mean)) * 100);
  return { ...EMPTY, hasData: true, amber: [`VFC ${pct} % bajo tu media`] };
}

/**
 * Sleep counts as ONE §11.8 signal (< 6 h or score < 60). SL2 (two short
 * nights in a row) makes the day amber on its own (§11.7); SL3 (low 7-day
 * average) is a weekly rule and a bad subjective night is only a note.
 */
function sleepSignals(metrics: readonly DailyMetrics[], today: ISODate, checkin: DailyCheckin | null): Signals {
  const hoursSlept = metricOn(metrics, today, 'sleepHours') ?? checkin?.sleepHours ?? null;
  const score = metricOn(metrics, today, 'sleepScore');
  const amber: string[] = [];
  const amberRules: string[] = [];
  const notes: string[] = [];
  const short = hoursSlept !== null && hoursSlept < READINESS.sleepAmberHours;
  if (short) amber.push(`Has dormido ${fmt(hoursSlept ?? 0, 1)} h`);
  else if (score !== null && score < READINESS.sleepScoreAmber) amber.push(`Sueño flojo (${Math.round(score)}/100)`);
  else if (checkin && checkin.sleepQuality <= 2) notes.push('Has dormido mal');
  const yesterday = metricOn(metrics, addDays(today, -1), 'sleepHours');
  if (short && yesterday !== null && yesterday < READINESS.sleepAmberHours) amberRules.push('Dos noches seguidas durmiendo menos de 6 h');
  const week = [...seriesBefore(metrics, today, 'sleepHours', 6), ...(hoursSlept !== null ? [hoursSlept] : [])];
  const avg = week.length >= 5 ? week.reduce((s, v) => s + v, 0) / week.length : null;
  if (avg !== null && avg < READINESS.sleepWeekAvgHours) notes.push(`Media de sueño de la semana: ${fmt(avg, 1)} h`);
  return { ...EMPTY, hasData: hoursSlept !== null || score !== null || checkin !== null, amber, amberRules, notes };
}

function garminSignals(metrics: readonly DailyMetrics[], today: ISODate): Signals {
  const tr = metricOn(metrics, today, 'trainingReadiness');
  const notes: string[] = [];
  const battery = metricOn(metrics, today, 'bodyBattery');
  if (battery !== null && battery < 25) notes.push(`Batería corporal baja (${Math.round(battery)})`);
  const stress = metricOn(metrics, today, 'stressAvg');
  if (stress !== null && stress > 50) notes.push(`Estrés medio alto (${Math.round(stress)})`);
  if (tr === null) return { ...EMPTY, notes, hasData: battery !== null || stress !== null };
  const text = `Preparación del reloj ${Math.round(tr)}/100`;
  if (tr < READINESS.trRed) return { ...EMPTY, hasData: true, red: [text], notes, garminScore: tr };
  if (tr < READINESS.trAmber) return { ...EMPTY, hasData: true, amber: [text], notes, garminScore: tr };
  return { ...EMPTY, hasData: true, notes, garminScore: tr };
}

/** Subjective body signal: fatigue ≥ 4 or soreness ≥ 4 is ONE amber signal (§11.8); fatigue 5 is red. */
function bodySignal(checkin: DailyCheckin): string | null {
  const tired = checkin.fatigue === 4;
  const sore = checkin.soreness >= 4;
  if (tired && sore) return `Fatiga y dolor muscular altos (${checkin.fatigue}/5 y ${checkin.soreness}/5)`;
  if (tired) return `Fatiga alta (${checkin.fatigue}/5)`;
  return sore ? `Dolor muscular alto (${checkin.soreness}/5)` : null;
}

function checkinSignals(checkin: DailyCheckin | null): Signals {
  if (!checkin) return EMPTY;
  const red: string[] = checkin.fatigue >= 5 ? ['Fatiga muy alta (5/5)'] : [];
  const body = bodySignal(checkin);
  const notes: string[] = [];
  if (checkin.stress >= 4) notes.push(`Estrés alto (${checkin.stress}/5)`);
  if (checkin.motivation <= 1) notes.push('Motivación muy baja');
  return { ...EMPTY, red, amber: body ? [body] : [], notes, hasData: true };
}

function ownScore(s: Signals, checkin: DailyCheckin | null): number {
  let score = 82 - 15 * (s.amber.length + s.amberRules.length) - 35 * s.red.length;
  if (checkin) score += (3 - checkin.fatigue) * 3 + (checkin.sleepQuality - 3) * 3 + (checkin.motivation - 3) * 2;
  return score;
}

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

const RECOMMENDATIONS: Record<ReadinessLevel | 'note', string> = {
  green: 'Todo en orden: sigue el plan de hoy.',
  note: 'Sigue el plan, pero si te notas cansado cambia la sesión dura por una suave.',
  amber: 'Hoy mejor con freno: recorta las series un 25-50 % o cámbialas por un rodaje suave.',
  red: 'Hoy toca descanso o algo muy suave (máximo 45 min en Z1, mejor nadar o rodar en bici).',
  unknown: 'Haz el check-in de la mañana o sincroniza tu reloj para ajustar el día.',
};

/** Combined readiness for `today`. */
export function computeReadiness(input: ReadinessInput): Readiness {
  const { today, metrics } = input;
  const checkin = input.checkin && input.checkin.date === today ? input.checkin : null;
  const signals = [
    garminSignals(metrics, today),
    hrvSignals(metrics, today),
    restingHrSignals(metrics, today),
    sleepSignals(metrics, today, checkin),
    checkinSignals(checkin),
  ].reduce(merge, EMPTY);
  if (!signals.hasData) return { score: null, level: 'unknown', factors: [], recommendation: RECOMMENDATIONS.unknown };

  const isAmber = signals.amber.length >= 2 || signals.amberRules.length > 0;
  const level: ReadinessLevel = signals.red.length > 0 ? 'red' : isAmber ? 'amber' : 'green';
  const own = ownScore(signals, checkin);
  let score = signals.garminScore !== null ? 0.6 * signals.garminScore + 0.4 * own : own;
  if (level === 'red') score = Math.min(score, 30);
  if (level === 'amber') score = Math.min(score, 60);
  const key = level === 'green' && signals.amber.length === 1 ? 'note' : level;
  return {
    score: clampScore(score),
    level,
    factors: [...signals.red, ...signals.amber, ...signals.amberRules, ...signals.notes],
    recommendation: RECOMMENDATIONS[key],
  };
}
