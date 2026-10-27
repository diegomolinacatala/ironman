/**
 * Narrowing of the v2 AI payloads: `briefings` rows, the `briefing` and
 * `meal` edge-function responses and `coach_jobs.extras`. Untrusted JSON in,
 * domain types (or null when the shape is unusable) out. Pure.
 */
import { isISODate } from '@/domain/dates';
import { mealSlotForTime } from '@/domain/mealEstimate';
import {
  MEAL_SLOTS,
  type Briefing,
  type ISODate,
  type ISODateTime,
  type MealAnalysis,
  type MealAnalysisInput,
  type SleepSnapshot,
  type SleepVerdict,
  type UUID,
} from '@/domain/types';

import { asArray, asNumber, asString, isRecord, oneOf, oneOfOr, pick, type JsonRecord } from './narrow';
import type { BriefingRow } from './rows';

const SLEEP_VERDICTS: readonly SleepVerdict[] = ['great', 'good', 'fair', 'poor', 'unknown'];
const CONFIDENCES = ['high', 'medium', 'low'] as const;
const ENGINES = ['ai', 'rules'] as const;
const MAX_ITEMS = 12;
const MAX_MEMORY = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edge functions answer JSON, but a missing content-type turns it into text. */
function asJsonRecord(value: unknown): JsonRecord | null {
  if (typeof value === 'string') {
    try {
      return asJsonRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function text(value: unknown): string | null {
  const s = asString(value)?.trim();
  return s ? s : null;
}

function nonNegative(value: unknown, decimals = 0): number | null {
  const n = asNumber(value);
  if (n === null || n < 0) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function timestamp(value: unknown): ISODateTime | null {
  const s = asString(value);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
}

/** `briefings.sleep` jsonb / response `sleep` → SleepSnapshot (camelCase, snake_case tolerated). */
export function parseSleepSnapshot(value: unknown): SleepSnapshot | null {
  const r = asJsonRecord(value);
  if (!r) return null;
  return {
    hours: nonNegative(pick(r, 'hours'), 2),
    score: nonNegative(pick(r, 'score')),
    deepMin: nonNegative(pick(r, 'deepMin', 'deep_min')),
    lightMin: nonNegative(pick(r, 'lightMin', 'light_min')),
    remMin: nonNegative(pick(r, 'remMin', 'rem_min')),
    awakeMin: nonNegative(pick(r, 'awakeMin', 'awake_min')),
    start: timestamp(pick(r, 'start')),
    end: timestamp(pick(r, 'end')),
    hrvMs: nonNegative(pick(r, 'hrvMs', 'hrv_ms'), 1),
    hrvBaselineMs: nonNegative(pick(r, 'hrvBaselineMs', 'hrv_baseline_ms'), 1),
    restingHr: nonNegative(pick(r, 'restingHr', 'resting_hr')),
    bodyBattery: nonNegative(pick(r, 'bodyBattery', 'body_battery')),
  };
}

export function rowToBriefing(row: BriefingRow): Briefing {
  return {
    date: row.date,
    headline: row.headline,
    sleepVerdict: oneOfOr(row.sleep_verdict, SLEEP_VERDICTS, 'unknown'),
    sleepSummary: row.sleep_summary ?? '',
    script: row.script,
    focus: row.focus ?? '',
    sleep: parseSleepSnapshot(row.sleep),
    engine: 'ai',
    // A refresh rewrites the row: the newest write is what the athlete hears.
    createdAt: row.updated_at ?? row.created_at,
  };
}

/** `briefing` edge-function response (camelCase Briefing) → Briefing, or null if unusable. */
export function parseBriefing(data: unknown, expectedDate: ISODate, now: ISODateTime): Briefing | null {
  const r = asJsonRecord(data);
  if (!r) return null;
  const headline = text(r.headline);
  const script = text(r.script);
  if (!headline || !script) return null;
  const date = asString(r.date);
  return {
    date: date && isISODate(date) ? date : expectedDate,
    headline,
    sleepVerdict: oneOfOr(pick(r, 'sleepVerdict', 'sleep_verdict'), SLEEP_VERDICTS, 'unknown'),
    sleepSummary: text(pick(r, 'sleepSummary', 'sleep_summary')) ?? '',
    script,
    focus: text(r.focus) ?? '',
    sleep: parseSleepSnapshot(r.sleep),
    engine: oneOfOr(r.engine, ENGINES, 'ai'),
    createdAt: timestamp(pick(r, 'createdAt', 'created_at')) ?? now,
  };
}

/** `meal` edge-function response → MealAnalysis, or null when it has no usable description. */
export function parseMealAnalysis(data: unknown, input: MealAnalysisInput): MealAnalysis | null {
  const r = asJsonRecord(data);
  const description = r ? text(r.description) : null;
  if (!r || !description) return null;
  const items = asArray(r.items)
    .map(text)
    .filter((item): item is string => item !== null)
    .slice(0, MAX_ITEMS);
  return {
    meal: oneOf(r.meal, MEAL_SLOTS) ?? mealSlotForTime(input.time),
    description,
    items,
    kcal: nonNegative(r.kcal),
    carbsG: nonNegative(pick(r, 'carbsG', 'carbs_g')),
    proteinG: nonNegative(pick(r, 'proteinG', 'protein_g')),
    fatG: nonNegative(pick(r, 'fatG', 'fat_g')),
    confidence: oneOfOr(r.confidence, CONFIDENCES, 'medium'),
    tip: text(r.tip),
    engine: oneOfOr(r.engine, ENGINES, 'ai'),
  };
}

export interface CoachExtras {
  memory: string[];
  lifeEventId: UUID | null;
}

export const EMPTY_COACH_EXTRAS: CoachExtras = { memory: [], lifeEventId: null };

/** `coach_jobs.extras` = `{ memory: string[], lifeEventId: uuid | null }`. */
export function parseCoachExtras(value: unknown): CoachExtras {
  const r = asJsonRecord(value);
  if (!r) return EMPTY_COACH_EXTRAS;
  const memory = asArray(r.memory)
    .map(text)
    .filter((line): line is string => line !== null)
    .slice(0, MAX_MEMORY);
  const id = asString(pick(r, 'lifeEventId', 'life_event_id'));
  return { memory, lifeEventId: id && UUID_RE.test(id) ? id : null };
}
