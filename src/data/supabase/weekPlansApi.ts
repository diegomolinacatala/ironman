/**
 * Season plan ("Plan → General") on Supabase: `week_plans` rows (own rows,
 * RLS), one per (user, Monday), upserted on that natural key. A server
 * without the v4 migration answers a clear "update the server" message
 * instead of a generic error.
 */
import { todayISO } from '@/domain/dates';
import { WEEK_PLAN_KINDS, type DateRange, type ISODate, type UUID, type WeekPlan, type WeekPlanDraft } from '@/domain/types';
import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import { assertWeekStartDate, cleanWeekPlanDrafts, type CleanWeekPlanDraft } from '../demo/validation';
import { run, type RawResult, type SupabaseCtx } from './base';
import { asNumber, asString, isRecord, oneOfOr } from './narrow';
import type { WeekPlanRow } from './rows';

type WeekPlanMethods = Pick<Repository, 'listWeekPlans' | 'saveWeekPlans' | 'deleteWeekPlan'>;

export const WEEK_PLAN_COLUMNS = 'user_id,week_start,kind,target_minutes,note,source,created_at,updated_at';
export const WEEK_PLANS_UNAVAILABLE = 'El servidor aún no tiene el plan general: hay que actualizarlo.';

/** Missing table (Postgres / PostgREST schema cache) or missing column. */
const MISSING_SCHEMA_CODES: readonly string[] = ['42P01', 'PGRST205', '42703', 'PGRST204'];
const SOURCES = ['manual', 'ai_coach', 'claude'] as const;

export function rowToWeekPlan(row: WeekPlanRow): WeekPlan {
  const minutes = asNumber(row.target_minutes);
  return {
    weekStart: row.week_start,
    kind: oneOfOr(row.kind, WEEK_PLAN_KINDS, 'load'),
    targetMinutes: minutes === null ? null : Math.round(minutes),
    note: asString(row.note)?.trim() || null,
    source: oneOfOr(row.source, SOURCES, 'manual'),
    updatedAt: row.updated_at ?? row.created_at ?? '',
  };
}

export function weekPlanToRow(plan: WeekPlan, userId: UUID): WeekPlanRow {
  return {
    user_id: userId,
    week_start: plan.weekStart,
    kind: plan.kind,
    target_minutes: plan.targetMinutes,
    note: plan.note,
    source: plan.source,
    updated_at: plan.updatedAt,
  };
}

/** Columns for the upsert (updated_at comes from the table trigger). */
export function weekPlanDraftToRow(draft: CleanWeekPlanDraft, userId: UUID): Omit<WeekPlanRow, 'updated_at' | 'created_at'> {
  return {
    user_id: userId,
    week_start: draft.weekStart,
    kind: draft.kind,
    target_minutes: draft.targetMinutes,
    note: draft.note,
    source: draft.source,
  };
}

function isMissingSchema(error: unknown): boolean {
  if (!(error instanceof RepositoryError)) return false;
  const code = isRecord(error.cause) ? asString(error.cause.code) : null;
  return code !== null && MISSING_SCHEMA_CODES.includes(code);
}

/** Like `run`, but a server without `week_plans` (v4 migration pending) says so in plain Spanish. */
async function runWeekPlans<T>(label: string, op: PromiseLike<RawResult>, fallback?: string): Promise<T> {
  try {
    return await run<T>(label, op, fallback);
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
    logger.warn('week_plans table unavailable', label);
    throw new RepositoryError('unavailable', WEEK_PLANS_UNAVAILABLE, error instanceof RepositoryError ? error.cause : error);
  }
}

function byWeek(a: WeekPlan, b: WeekPlan): number {
  return a.weekStart.localeCompare(b.weekStart);
}

export function weekPlansApi(ctx: SupabaseCtx): WeekPlanMethods {
  const { client } = ctx;
  const today = (): ISODate => todayISO(new Date(ctx.now()));

  async function listWeekPlans(range: DateRange): Promise<WeekPlan[]> {
    const me = await ctx.userId();
    const rows = await runWeekPlans<WeekPlanRow[] | null>(
      'listWeekPlans',
      client
        .from('week_plans')
        .select(WEEK_PLAN_COLUMNS)
        .eq('user_id', me)
        .gte('week_start', range.from)
        .lte('week_start', range.to)
        .order('week_start', { ascending: true }),
    );
    return (rows ?? []).map(rowToWeekPlan).sort(byWeek);
  }

  async function saveWeekPlans(drafts: WeekPlanDraft[]): Promise<WeekPlan[]> {
    const clean = cleanWeekPlanDrafts(drafts, today());
    if (clean.length === 0) return [];
    const me = await ctx.userId();
    const rows = await runWeekPlans<WeekPlanRow[] | null>(
      'saveWeekPlans',
      client
        .from('week_plans')
        .upsert(
          clean.map((d) => weekPlanDraftToRow(d, me)),
          { onConflict: 'user_id,week_start' },
        )
        .select(WEEK_PLAN_COLUMNS),
      'No se ha podido guardar tu plan general.',
    );
    return (rows ?? []).map(rowToWeekPlan).sort(byWeek);
  }

  async function deleteWeekPlan(weekStart: ISODate): Promise<void> {
    assertWeekStartDate(weekStart);
    const me = await ctx.userId();
    await runWeekPlans<unknown>(
      'deleteWeekPlan',
      client.from('week_plans').delete().eq('user_id', me).eq('week_start', weekStart),
      'No se ha podido quitar el ajuste de la semana.',
    );
  }

  return { listWeekPlans, saveWeekPlans, deleteWeekPlan };
}
