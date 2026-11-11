/**
 * Narrowing of the v2 AI payloads: `briefings` rows, the `briefing` and
 * `meal` edge-function responses and `coach_jobs.extras`. Untrusted JSON in,
 * domain types (or null when the shape is unusable) out. Pure.
 */
import { addDays, isISODate, startOfWeek, weekdayOf } from '@/domain/dates';
import { mealSlotForTime } from '@/domain/mealEstimate';
import {
  INTENSITIES,
  MEAL_SLOTS,
  SPORTS,
  WEEK_PLAN_KINDS,
  type Briefing,
  type ISODate,
  type ISODateTime,
  type MealAnalysis,
  type MealAnalysisInput,
  type QuedadaSuggestion,
  type SleepSnapshot,
  type SleepVerdict,
  type UUID,
  type WeekPlanDraft,
} from '@/domain/types';

import { asArray, asNumber, asString, isRecord, oneOf, oneOfOr, pick, type JsonRecord } from './narrow';
import type { BriefingRow } from './rows';

const SLEEP_VERDICTS: readonly SleepVerdict[] = ['great', 'good', 'fair', 'poor', 'unknown'];
const CONFIDENCES = ['high', 'medium', 'low'] as const;
const ENGINES = ['ai', 'rules'] as const;
const MAX_ITEMS = 12;
const MAX_MEMORY = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const QUEDADA_SPORTS = SPORTS.filter((s) => s !== 'rest');
const QUEDADA_LIMITS = { minDuration: 5, maxDuration: 720, titleMax: 120, locationMax: 200, reasonMax: 300, nameMax: 120 } as const;

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
  quedada: QuedadaSuggestion | null;
  /** Week-level plan the coach suggests (Plan → General), saved only on the athlete's tap. */
  weekPlans: WeekPlanDraft[];
}

export const EMPTY_COACH_EXTRAS: CoachExtras = { memory: [], lifeEventId: null, quedada: null, weekPlans: [] };

/** Same limits as `week_plans` (and the repository validation). */
const WEEK_PLAN_LIMITS = { maxMinutes: 3000, noteMax: 300, maxWeeks: 52 } as const;

function weekPlanMinutes(value: unknown): number | null {
  const n = asNumber(value);
  return n !== null && n >= 0 && n <= WEEK_PLAN_LIMITS.maxMinutes ? Math.round(n) : null;
}

/**
 * One suggested week (camelCase or snake_case) → WeekPlanDraft with source
 * 'ai_coach', or null without a Monday or a known kind. Out-of-range minutes
 * fall back to the periodization (null); the note is clipped to 300 chars.
 */
export function parseWeekPlanSuggestion(value: unknown): WeekPlanDraft | null {
  const r = asJsonRecord(value);
  if (!r) return null;
  const weekStart = asString(pick(r, 'weekStart', 'week_start'));
  const kind = oneOf(r.kind, WEEK_PLAN_KINDS);
  if (!weekStart || !isISODate(weekStart) || weekdayOf(weekStart) !== 0 || !kind) return null;
  const note = text(r.note);
  return {
    weekStart,
    kind,
    targetMinutes: weekPlanMinutes(pick(r, 'targetMinutes', 'target_minutes')),
    note: note ? note.slice(0, WEEK_PLAN_LIMITS.noteMax).trimEnd() : null,
    source: 'ai_coach',
  };
}

/** Suggested weeks: valid entries only, one per Monday (the last one wins), ordered. */
export function parseWeekPlanSuggestions(value: unknown): WeekPlanDraft[] {
  const drafts = asArray(value)
    .map(parseWeekPlanSuggestion)
    .filter((d): d is WeekPlanDraft => d !== null);
  const byWeek = new Map(drafts.map((d) => [d.weekStart, d] as const));
  return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Keeps the suggestions the athlete can still save: from this week up to +52 weeks. */
export function weekPlansFrom(drafts: readonly WeekPlanDraft[], today: ISODate): WeekPlanDraft[] {
  const first = startOfWeek(today);
  const last = addDays(first, WEEK_PLAN_LIMITS.maxWeeks * 7);
  return drafts.filter((d) => d.weekStart >= first && d.weekStart <= last);
}

function boundedText(value: unknown, max: number): string | null {
  const s = text(value);
  return s && s.length <= max ? s : null;
}

/**
 * `extras.quedada` (camelCase, snake_case tolerated) → QuedadaSuggestion, or
 * null when anything is off (the server validated it, but this is still
 * untrusted JSON that ends up in a form).
 */
export function parseQuedadaSuggestion(value: unknown): QuedadaSuggestion | null {
  const r = asJsonRecord(value);
  if (!r) return null;
  const friendId = asString(pick(r, 'friendId', 'friend_id'));
  const friendName = boundedText(pick(r, 'friendName', 'friend_name'), QUEDADA_LIMITS.nameMax);
  const sport = oneOf(r.sport, QUEDADA_SPORTS);
  const date = asString(r.date);
  const rawTime = pick(r, 'startTime', 'start_time');
  const startTime = rawTime === null || rawTime === undefined ? null : asString(rawTime);
  const duration = asNumber(pick(r, 'durationMin', 'duration_min'));
  const intensity = oneOf(r.intensity, INTENSITIES);
  const title = boundedText(r.title, QUEDADA_LIMITS.titleMax);
  const rawLocation = r.location;
  const location = rawLocation === null || rawLocation === undefined ? null : text(rawLocation);
  if (!friendId || !UUID_RE.test(friendId) || !friendName || !sport || !intensity || !title) return null;
  if (!date || !isISODate(date)) return null;
  if (startTime !== null && !TIME_RE.test(startTime)) return null;
  if (duration === null || !Number.isInteger(duration) || duration < QUEDADA_LIMITS.minDuration || duration > QUEDADA_LIMITS.maxDuration) return null;
  if (location !== null && location.length > QUEDADA_LIMITS.locationMax) return null;
  return {
    friendId,
    friendName,
    sport,
    date,
    startTime,
    durationMin: duration,
    intensity,
    title,
    location,
    reason: (text(r.reason) ?? '').slice(0, QUEDADA_LIMITS.reasonMax),
  };
}

/**
 * `coach_jobs.extras` = `{ memory: string[], lifeEventId: uuid | null,
 * quedada: {…} | null, weekPlans: [{ weekStart, kind, targetMinutes, note }] | null }`.
 */
export function parseCoachExtras(value: unknown): CoachExtras {
  const r = asJsonRecord(value);
  if (!r) return EMPTY_COACH_EXTRAS;
  const memory = asArray(r.memory)
    .map(text)
    .filter((line): line is string => line !== null)
    .slice(0, MAX_MEMORY);
  const id = asString(pick(r, 'lifeEventId', 'life_event_id'));
  return {
    memory,
    lifeEventId: id && UUID_RE.test(id) ? id : null,
    quedada: parseQuedadaSuggestion(r.quedada),
    weekPlans: parseWeekPlanSuggestions(pick(r, 'weekPlans', 'week_plans')),
  };
}
