/**
 * Pure helpers for the morning briefing ("Informe de hoy"): card state, sleep facts,
 * HRV trend, sleep stages, sleep window and listening time. Unit-tested.
 */
import { dateTimeParts, formatDuration, minutesToTime } from '@/domain/dates';
import type { Briefing, IntegrationStatus, SleepSnapshot, SleepVerdict } from '@/domain/types';
import type { IconName } from '@/ui';

// ---------------------------------------------------------------------------
// Garmin connection
// ---------------------------------------------------------------------------

export type GarminState = 'connected' | 'expired' | 'missing';

/** Garmin Personal API state from the integrations list ('expired' covers error/expired keys). */
export function garminState(integrations: readonly IntegrationStatus[] | undefined): GarminState {
  const garmin = (integrations ?? []).find((i) => i.provider === 'garmin_personal');
  if (!garmin || garmin.state === 'disconnected') return 'missing';
  return garmin.state === 'connected' ? 'connected' : 'expired';
}

// ---------------------------------------------------------------------------
// Card state
// ---------------------------------------------------------------------------

export type BriefingCardState = 'loading' | 'connect-garmin' | 'empty' | 'generating' | 'error' | 'ready';

export interface BriefingCardInput {
  briefing: Briefing | null | undefined;
  briefingLoading: boolean;
  briefingError: unknown;
  generating: boolean;
  generateError: unknown;
  garmin: GarminState | 'loading';
  /** The athlete chose to prepare the briefing without Garmin. */
  skipGarmin: boolean;
}

/** Which version of the "Informe de hoy" card to show. An existing briefing always wins. */
export function briefingCardState(input: BriefingCardInput): BriefingCardState {
  if (input.briefing) return 'ready';
  if (input.generating) return 'generating';
  if (input.briefingLoading || input.garmin === 'loading') return 'loading';
  if (input.generateError != null || input.briefingError != null) return 'error';
  if (input.garmin !== 'connected' && !input.skipGarmin) return 'connect-garmin';
  return 'empty';
}

/** Friendly progress copy while the briefing is being prepared (rotates every few seconds). */
export const BRIEFING_STEPS = ['Leyendo tu Garmin…', 'Mirando tu plan de hoy…', 'Escribiendo tu informe…'] as const;

/** Progress steps for this athlete (no "Leyendo tu Garmin…" without Garmin). */
export function briefingSteps(garminConnected: boolean): readonly string[] {
  return garminConnected ? BRIEFING_STEPS : BRIEFING_STEPS.slice(1);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function isNumber(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** 7.33 → "7h 20'" (null when unknown). */
export function formatSleepHours(hours: number | null | undefined): string | null {
  if (!isNumber(hours) || hours <= 0) return null;
  return formatDuration(Math.round(hours * 60));
}

/** Screen-reader duration: 440 → "7 horas y 20 minutos". */
export function spokenDuration(totalMin: number): string {
  const safe = Math.max(0, Math.round(totalMin));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  const hours = h === 1 ? '1 hora' : `${h} horas`;
  const minutes = m === 1 ? '1 minuto' : `${m} minutos`;
  if (h === 0) return minutes;
  return m === 0 ? hours : `${hours} y ${minutes}`;
}

const VERDICT_LABEL: Record<SleepVerdict, string> = {
  great: 'Has dormido muy bien',
  good: 'Has dormido bien',
  fair: 'Noche regular',
  poor: 'Noche floja',
  unknown: 'Sin datos de sueño',
};

export function sleepVerdictLabel(verdict: SleepVerdict): string {
  return VERDICT_LABEL[verdict] ?? VERDICT_LABEL.unknown;
}

// ---------------------------------------------------------------------------
// HRV vs baseline
// ---------------------------------------------------------------------------

export type Trend = 'up' | 'down' | 'flat';

export interface HrvTrend {
  direction: Trend;
  /** Rounded % difference vs the 7-night baseline. */
  deltaPct: number;
  /** Short label: "Por encima de tu media". */
  text: string;
  /** Long sentence for the briefing screen. */
  detail: string;
}

/** Within ±5 % of the baseline counts as "en tu media". */
const HRV_FLAT_PCT = 5;

export function hrvTrend(hrvMs: number | null | undefined, baselineMs: number | null | undefined): HrvTrend | null {
  if (!isNumber(hrvMs) || !isNumber(baselineMs) || baselineMs <= 0) return null;
  const deltaPct = Math.round(((hrvMs - baselineMs) / baselineMs) * 100);
  const base = `tu media de 7 noches (${Math.round(baselineMs)} ms)`;
  if (Math.abs(deltaPct) < HRV_FLAT_PCT) {
    return { direction: 'flat', deltaPct, text: 'En tu media', detail: `En ${base}` };
  }
  if (deltaPct > 0) {
    return { direction: 'up', deltaPct, text: 'Por encima de tu media', detail: `${deltaPct} % por encima de ${base}` };
  }
  return { direction: 'down', deltaPct, text: 'Por debajo de tu media', detail: `${Math.abs(deltaPct)} % por debajo de ${base}` };
}

// ---------------------------------------------------------------------------
// Sleep facts (compact row on the Hoy card)
// ---------------------------------------------------------------------------

export interface SleepFact {
  key: 'hours' | 'score' | 'hrv' | 'battery';
  icon: IconName;
  value: string;
  label: string;
  trend?: Trend;
  a11y: string;
}

/** Up to four headline numbers of last night, skipping what Garmin did not report. */
export function sleepFacts(sleep: SleepSnapshot | null | undefined): SleepFact[] {
  if (!sleep) return [];
  const facts: SleepFact[] = [];
  const hours = formatSleepHours(sleep.hours);
  if (hours && isNumber(sleep.hours)) {
    facts.push({ key: 'hours', icon: 'sleep', value: hours, label: 'Sueño', a11y: `Sueño: ${spokenDuration(sleep.hours * 60)}` });
  }
  if (isNumber(sleep.score)) {
    const score = Math.round(sleep.score);
    facts.push({ key: 'score', icon: 'moon', value: String(score), label: 'Puntuación', a11y: `Puntuación de sueño: ${score} de 100` });
  }
  if (isNumber(sleep.hrvMs)) {
    const hrv = Math.round(sleep.hrvMs);
    const trend = hrvTrend(sleep.hrvMs, sleep.hrvBaselineMs);
    facts.push({
      key: 'hrv',
      icon: 'hrv',
      value: `${hrv} ms`,
      label: trend ? trend.text : 'VFC',
      trend: trend?.direction,
      a11y: `Variabilidad cardiaca: ${hrv} milisegundos${trend ? `, ${trend.text.toLowerCase()}` : ''}`,
    });
  }
  if (isNumber(sleep.bodyBattery)) {
    const battery = Math.round(sleep.bodyBattery);
    facts.push({ key: 'battery', icon: 'battery', value: String(battery), label: 'Body Battery', a11y: `Body Battery: ${battery} de 100` });
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Sleep stages
// ---------------------------------------------------------------------------

export type SleepStageKey = 'deep' | 'rem' | 'light' | 'awake';

export interface SleepStage {
  key: SleepStageKey;
  label: string;
  minutes: number;
  /** Whole percentage of the night; the stages always add up to 100. */
  pct: number;
}

const STAGE_LABEL: Record<SleepStageKey, string> = { deep: 'Profundo', rem: 'REM', light: 'Ligero', awake: 'Despierto' };
const STAGE_ORDER: readonly SleepStageKey[] = ['deep', 'rem', 'light', 'awake'];

/** Splits 100 into whole percentages proportional to `values` (largest remainder). */
function wholePercentages(values: readonly number[], total: number): number[] {
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  const missing = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  const bonus = new Set(order.slice(0, missing).map((o) => o.i));
  return floors.map((f, i) => (bonus.has(i) ? f + 1 : f));
}

/** Deep / REM / light / awake minutes with their share of the night (stages with 0 min are dropped). */
export function sleepStages(sleep: SleepSnapshot | null | undefined): SleepStage[] {
  if (!sleep) return [];
  const raw: Record<SleepStageKey, number | null> = {
    deep: sleep.deepMin,
    rem: sleep.remMin,
    light: sleep.lightMin,
    awake: sleep.awakeMin,
  };
  const entries = STAGE_ORDER.map((key) => {
    const value = raw[key];
    return { key, minutes: isNumber(value) ? Math.max(0, Math.round(value)) : 0 };
  }).filter((e) => e.minutes > 0);
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);
  if (total <= 0) return [];
  const pcts = wholePercentages(
    entries.map((e) => e.minutes),
    total,
  );
  return entries.map((e, i) => ({ key: e.key, label: STAGE_LABEL[e.key], minutes: e.minutes, pct: pcts[i] ?? 0 }));
}

/** Bedtime and wake-up time in local 24 h ("23:40" → "07:05"), or null. */
export function sleepWindow(sleep: SleepSnapshot | null | undefined): { start: string; end: string } | null {
  if (!sleep?.start || !sleep.end) return null;
  const start = dateTimeParts(sleep.start);
  const end = dateTimeParts(sleep.end);
  if (!start || !end) return null;
  return { start: minutesToTime(start.minutes), end: minutesToTime(end.minutes) };
}

/** True when the snapshot has anything worth a sleep card. */
export function hasSleepData(sleep: SleepSnapshot | null | undefined): boolean {
  if (!sleep) return false;
  return [sleep.hours, sleep.score, sleep.hrvMs, sleep.restingHr, sleep.bodyBattery, sleep.deepMin, sleep.lightMin].some(isNumber);
}

/** Short headlines get the big display type; long ones the title size (avoids 5-line walls). */
const DISPLAY_HEADLINE_MAX = 42;

export function headlineVariant(headline: string): 'display' | 'title' {
  return headline.trim().length <= DISPLAY_HEADLINE_MAX ? 'display' : 'title';
}

// ---------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------

/** Spanish TTS reads ~150 words per minute. */
const WORDS_PER_MINUTE = 150;

/** "1 min" — approximate listening time of the script. */
export function listenLabel(script: string): string {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min`;
}

export type PlayerMode = 'idle' | 'playing' | 'paused';

export function playerMode(speaker: { speaking: boolean; paused: boolean }): PlayerMode {
  if (speaker.paused) return 'paused';
  return speaker.speaking ? 'playing' : 'idle';
}
