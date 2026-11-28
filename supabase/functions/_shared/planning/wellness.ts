/**
 * Compact wellness signals for Claude (docs/research/02 §11.8): latest values
 * versus the athlete's own recent baseline. Descriptive only — never a
 * diagnosis. Plus the illness signal of last night with the athlete's answer
 * in the morning check-in (mirrored domain/illness.ts, the same the app uses).
 */
import { localParts, timeToMinutes } from '../dates.ts';
import type { DailyCheckin, DailyMetrics, IllnessAnswer, ISODate, LifeEvent } from '../types.ts';
import { illnessOutcome, illnessSignal } from './domain/illness.ts';
import type { IllnessLevel, IllnessOutcomeKind } from './domain/illness.ts';
import { clockOf, stressSleepSignal, suggestedBedtime } from './domain/stressSleep.ts';
import type { StressSleepLevel } from './domain/stressSleep.ts';

export interface WellnessSignals {
  latestDate: ISODate | null;
  signals: string[];
  level: 'green' | 'amber' | 'red' | 'unknown';
}

/** Last night's possible-illness signal and what the athlete answered (for the coach, Claude and the briefing). */
export interface IllnessView {
  /** watch = breathing or pulse above their baseline; likely = both, or one with the HRV drop; none = numbers normal (but the athlete feels ill). */
  signal: IllnessLevel;
  /** Morning check-in answer: symptoms | alcohol | heat | stress | fine; null = not answered yet. */
  answer: IllnessAnswer | null;
  /** possible_illness (go easy) | explained (no alarm) | fine (keep the plan) | unanswered. */
  outcome: IllnessOutcomeKind;
  /** The sentence to tell the athlete, with tact. */
  message: string;
  /** Short line for the signals list. */
  factor: string;
  /** The numbers behind it ("Respiración durante el sueño 16,1 resp/min, +1,4 sobre tu media (14,7)"). */
  reasons: string[];
}

/**
 * `metrics` should reach 28 nights back for the baseline; `checkins` must include
 * today's for the answer. Null when there is nothing to say.
 */
export function illnessView(metrics: readonly DailyMetrics[], checkins: readonly DailyCheckin[], today: ISODate): IllnessView | null {
  const answer = checkins.find((c) => c.date === today)?.illnessAnswer ?? null;
  const outcome = illnessOutcome(illnessSignal(metrics, today), answer);
  if (!outcome) return null;
  return { signal: outcome.level, answer: outcome.answer, outcome: outcome.kind, message: outcome.message, factor: outcome.factor, reasons: outcome.reasons };
}

/**
 * Stress that is costing the athlete sleep (mirrored domain/stressSleep.ts, the same the app
 * uses): two of the last three nights with a stressful day before and worse sleep than usual.
 */
export interface StressSleepView {
  /** moderate (ease 2 days) | high (3 days: three nights, an exam period or 1 h 30 less sleep). */
  level: StressSleepLevel;
  /** An exam around today. */
  exam: boolean;
  flaggedNights: number;
  stressDays: number;
  /** «Estrés alto 3 días y dormiste 1 h menos de lo habitual: hoy suave y acuéstate antes.» */
  message: string;
  /** Days to ease from today. */
  easeDays: number;
  /** Usual bedtime and the suggested one (30 min earlier), local 'HH:mm'. */
  usualBedtime: string;
  suggestedBedtime: string;
  /** One line per flagged night with its numbers. */
  reasons: string[];
}

/**
 * `metrics` should reach ~31 days back (28-night baseline + the window), `checkins` the last
 * 3 days and `events` the exams around today; `tz` turns bedtimes into local times. Null when
 * there is nothing to say (or not enough data).
 */
export function stressSleepView(
  metrics: readonly DailyMetrics[],
  checkins: readonly DailyCheckin[],
  events: readonly LifeEvent[],
  today: ISODate,
  tz: string,
): StressSleepView | null {
  const localMinutes = (iso: string): number | null => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? timeToMinutes(localParts(d, tz).time) : null;
  };
  const signal = stressSleepSignal({ today, metrics, checkins, lifeEvents: events, localMinutes });
  if (!signal) return null;
  return {
    level: signal.level,
    exam: signal.exam,
    flaggedNights: signal.flaggedNights,
    stressDays: signal.stressDays,
    message: signal.message,
    easeDays: signal.easeDays,
    usualBedtime: clockOf(signal.usualBedtimeMin),
    suggestedBedtime: clockOf(suggestedBedtime(signal)),
    reasons: signal.reasons,
  };
}

/** Symptoms make the day amber (red with a likely signal), like the app's readiness; anything else is a note. */
function withIllness(base: WellnessSignals, illness: IllnessView | null | undefined): WellnessSignals {
  if (!illness) return base;
  const signals = [...base.signals, illness.factor];
  if (illness.outcome !== 'possible_illness') return { ...base, signals };
  const floor = illness.signal === 'likely' ? 'red' : 'amber';
  const level = base.level === 'red' || floor === 'red' ? 'red' : 'amber';
  return { ...base, signals, level };
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

function numbers(rows: readonly DailyMetrics[], pick: (m: DailyMetrics) => number | null): number[] {
  return rows.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** Merge priority of metric sources, field by field (docs/V4.md §2): garmin > coros > healthkit > manual. */
const SOURCE_RANK: Readonly<Record<DailyMetrics['source'], number>> = { garmin: 0, coros: 1, healthkit: 2, manual: 3 };

/** One row per date, preferring Garmin, then COROS, Apple Health and manual entries, field by field. */
export function mergeMetricsByDate(rows: readonly DailyMetrics[]): DailyMetrics[] {
  const rank = SOURCE_RANK;
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || rank[a.source] - rank[b.source]);
  const byDate = new Map<ISODate, DailyMetrics>();
  for (const row of sorted) {
    const prev = byDate.get(row.date);
    if (!prev) {
      byDate.set(row.date, row);
      continue;
    }
    const a = prev as unknown as Record<string, unknown>;
    const b = row as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const merged = Object.fromEntries([...keys].map((k) => [k, a[k] ?? b[k] ?? null])) as unknown as DailyMetrics;
    byDate.set(row.date, merged);
  }
  return [...byDate.values()];
}

/** The day before `date` (ISO, UTC arithmetic on a calendar date). */
function dayBefore(date: ISODate): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * With `today`, only today's or yesterday's metrics and check-in describe the
 * athlete now: an older row (a 5/5 fatigue five days ago, the last sync a week
 * ago) no longer turns today red. Yesterday's values are labelled "(ayer)".
 */
export function wellnessSignals(
  metrics: readonly DailyMetrics[],
  checkins: readonly DailyCheckin[],
  today?: ISODate,
  illness?: IllnessView | null,
): WellnessSignals {
  return withIllness(baseSignals(metrics, checkins, today), illness);
}

function baseSignals(metrics: readonly DailyMetrics[], checkins: readonly DailyCheckin[], today?: ISODate): WellnessSignals {
  const fresh = (date: ISODate) => !today || (date <= today && date >= dayBefore(today));
  const merged = mergeMetricsByDate(today ? metrics.filter((m) => m.date <= today) : metrics);
  const newest = merged[merged.length - 1] ?? null;
  const latest = newest && fresh(newest.date) ? newest : null;
  const sortedCheckins = [...checkins].filter((c) => !today || c.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const newestCheckin = sortedCheckins[sortedCheckins.length - 1] ?? null;
  const lastCheckin = newestCheckin && fresh(newestCheckin.date) ? newestCheckin : null;
  const yesterdayNote = (date: ISODate) => (today && date < today ? ' (ayer)' : '');
  const signals: string[] = [];
  let amber = 0;
  let red = 0;
  if (latest) {
    const note = yesterdayNote(latest.date);
    const baseline = merged.slice(0, -1);
    const hrvMean = mean(numbers(baseline, (m) => m.hrvMs));
    if (latest.hrvMs != null && hrvMean) {
      const pct = Math.round(((latest.hrvMs - hrvMean) / hrvMean) * 100);
      if (pct <= -10) {
        signals.push(`VFC ${latest.hrvMs} ms, ${Math.abs(pct)} % por debajo de su media reciente${note}`);
        amber += 1;
      }
    }
    const rhrMean = mean(numbers(baseline, (m) => m.restingHr));
    if (latest.restingHr != null && rhrMean) {
      const delta = Math.round(latest.restingHr - rhrMean);
      if (delta >= 8) red += 1;
      if (delta >= 5) signals.push(`FC en reposo +${delta} lpm sobre su media${note}`);
      if (delta >= 5 && delta < 8) amber += 1;
    }
    if (latest.sleepHours != null && latest.sleepHours < 6) {
      signals.push(`Durmió ${latest.sleepHours.toFixed(1).replace('.', ',')} h${note}`);
      amber += 1;
    }
    if (latest.trainingReadiness != null && latest.trainingReadiness < 50) {
      signals.push(`Disposición para entrenar del reloj ${latest.trainingReadiness}/100${note}`);
      if (latest.trainingReadiness < 25) red += 1;
      else amber += 1;
    }
    if (latest.bodyBattery != null && latest.bodyBattery < 30) signals.push(`Body Battery bajo (${latest.bodyBattery})${note}`);
  }
  if (lastCheckin) {
    // Unanswered scales (null) count as nothing.
    const fatigue = lastCheckin.fatigue ?? 0;
    const soreness = lastCheckin.soreness ?? 0;
    if (fatigue >= 5) red += 1;
    else if (fatigue >= 4 || soreness >= 4) amber += 1;
    if (fatigue >= 4) signals.push(`Fatiga subjetiva ${fatigue}/5 (${lastCheckin.date})`);
    if (soreness >= 4) signals.push(`Agujetas/dolor muscular ${soreness}/5${yesterdayNote(lastCheckin.date)}`);
    if ((lastCheckin.stress ?? 0) >= 4) signals.push(`Estrés ${lastCheckin.stress}/5${yesterdayNote(lastCheckin.date)}`);
    if (lastCheckin.habits.sick === true) {
      amber += 2;
      signals.push(`Se nota enfermo o incubando algo (${lastCheckin.date})`);
    }
    if (lastCheckin.habits.niggle === true) signals.push(`Tiene alguna molestia o dolor (${lastCheckin.date})`);
  }
  const level = !latest && !lastCheckin ? 'unknown' : red > 0 ? 'red' : amber >= 2 ? 'amber' : 'green';
  return { latestDate: latest?.date ?? lastCheckin?.date ?? null, signals, level };
}
