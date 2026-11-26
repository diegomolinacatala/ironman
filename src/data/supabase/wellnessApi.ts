import type {
  CheckinDraft,
  DailyCheckin,
  DailyMetrics,
  DateRange,
  MetricsDraft,
  NutritionDraft,
  NutritionLog,
  UUID,
} from '@/domain/types';

import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import { assertNutrition } from '../demo/validation';
import { run, runOne, runVoid, type SupabaseCtx } from './base';
import { isRecord } from './narrow';
import {
  checkinDraftToRow,
  metricsDraftToRow,
  nutritionDraftToInsert,
  rowToCheckin,
  rowToMetrics,
  rowToNutrition,
} from './mappers';
import type { CheckinRow, MetricsRow, NutritionRow } from './rows';

type WellnessMethods = Pick<
  Repository,
  | 'listCheckins'
  | 'upsertCheckin'
  | 'listMetrics'
  | 'upsertMetrics'
  | 'listNutrition'
  | 'createNutrition'
  | 'deleteNutrition'
>;

const METRICS_V1_COLUMNS =
  'user_id,date,source,hrv_ms,resting_hr,sleep_hours,sleep_score,body_battery,training_readiness,vo2max,steps,stress_avg,training_status';
const METRICS_V2_COLUMNS = `${METRICS_V1_COLUMNS},sleep_deep_min,sleep_light_min,sleep_rem_min,sleep_awake_min,sleep_start,sleep_end`;
/** Night vitals of the illness signal (`20261126000200_illness_signal.sql`). */
const ILLNESS_METRIC_COLUMNS = ['sleep_respiration', 'sleep_avg_hr'] as const;
/** Everything but `raw` (large Garmin payload). The sleep_* columns come from the v2 migration. */
export const METRICS_COLUMNS = `${METRICS_V2_COLUMNS},${ILLNESS_METRIC_COLUMNS.join(',')}`;
/** Newest first: a database without a migration still answers with the columns it has. */
const METRICS_COLUMN_SETS = [METRICS_COLUMNS, METRICS_V2_COLUMNS, METRICS_V1_COLUMNS] as const;

/**
 * A column the app sends or reads does not exist yet (migration not applied): Postgres 42703
 * on reads, PostgREST PGRST204 ("could not find the column") on writes.
 */
export function isMissingColumn(error: unknown): boolean {
  return error instanceof RepositoryError && isRecord(error.cause) && (error.cause.code === '42703' || error.cause.code === 'PGRST204');
}

function without<T extends object>(row: T, keys: readonly string[]): T {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k))) as T;
}

export function wellnessApi(ctx: SupabaseCtx): WellnessMethods {
  const { client } = ctx;

  async function listCheckins(range: DateRange): Promise<DailyCheckin[]> {
    const me = await ctx.userId();
    const rows = await run<CheckinRow[] | null>(
      'listCheckins',
      client
        .from('daily_checkins')
        .select('*')
        .eq('user_id', me)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true }),
    );
    return (rows ?? []).map(rowToCheckin);
  }

  async function saveCheckinRow(row: CheckinRow): Promise<CheckinRow> {
    return runOne<CheckinRow>(
      'upsertCheckin',
      client.from('daily_checkins').upsert({ ...row, updated_at: ctx.now() }, { onConflict: 'user_id,date' }).select('*').single(),
      'No se ha podido guardar el check-in.',
    );
  }

  async function upsertCheckin(draft: CheckinDraft): Promise<DailyCheckin> {
    const me = await ctx.userId();
    const row = checkinDraftToRow(draft, me);
    try {
      return rowToCheckin(await saveCheckinRow(row));
    } catch (error) {
      // Never lose a check-in because the illness migration is not deployed yet: save it without the answer.
      if (!('illness_answer' in row) || !isMissingColumn(error)) throw error;
      logger.warn('daily_checkins without illness_answer');
      return rowToCheckin(await saveCheckinRow(without(row, ['illness_answer'])));
    }
  }

  async function selectMetrics(me: UUID, range: DateRange, columns: string): Promise<MetricsRow[] | null> {
    return run<MetricsRow[] | null>(
      'listMetrics',
      client
        .from('daily_metrics')
        .select(columns)
        .eq('user_id', me)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true }),
    );
  }

  async function listMetrics(range: DateRange): Promise<DailyMetrics[]> {
    const me = await ctx.userId();
    for (const [i, columns] of METRICS_COLUMN_SETS.entries()) {
      try {
        return ((await selectMetrics(me, range, columns)) ?? []).map(rowToMetrics);
      } catch (error) {
        // Keep the app working against a database without the newest columns (v2 sleep, illness).
        if (!isMissingColumn(error) || i === METRICS_COLUMN_SETS.length - 1) throw error;
        logger.warn('daily_metrics without some columns, retrying with fewer');
      }
    }
    return [];
  }

  async function saveMetricsRows(rows: MetricsRow[]): Promise<void> {
    await runVoid('upsertMetrics', client.from('daily_metrics').upsert(rows, { onConflict: 'user_id,date,source' }));
  }

  async function upsertMetrics(drafts: MetricsDraft[]): Promise<void> {
    if (drafts.length === 0) return;
    const me = await ctx.userId();
    const now = ctx.now();
    const rows = drafts.map((d) => ({ ...metricsDraftToRow(d, me), updated_at: now }));
    try {
      await saveMetricsRows(rows);
    } catch (error) {
      // Apple Salud keeps syncing sleep and HRV before the illness migration is deployed.
      const hasIllness = rows.some((r) => ILLNESS_METRIC_COLUMNS.some((c) => c in r));
      if (!hasIllness || !isMissingColumn(error)) throw error;
      logger.warn('daily_metrics without illness columns');
      await saveMetricsRows(rows.map((r) => without(r, ILLNESS_METRIC_COLUMNS)));
    }
  }

  async function listNutrition(range: DateRange): Promise<NutritionLog[]> {
    const me = await ctx.userId();
    const rows = await run<NutritionRow[] | null>(
      'listNutrition',
      client
        .from('nutrition_logs')
        .select('*')
        .eq('user_id', me)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
    );
    return (rows ?? []).map(rowToNutrition);
  }

  async function createNutrition(draft: NutritionDraft): Promise<NutritionLog> {
    assertNutrition(draft);
    const me = await ctx.userId();
    const row = await runOne<NutritionRow>(
      'createNutrition',
      client.from('nutrition_logs').insert(nutritionDraftToInsert(draft, me)).select('*').single(),
      'No se ha podido guardar la comida.',
    );
    return rowToNutrition(row);
  }

  async function deleteNutrition(id: UUID): Promise<void> {
    await runVoid('deleteNutrition', client.from('nutrition_logs').delete().eq('id', id));
  }

  return { listCheckins, upsertCheckin, listMetrics, upsertMetrics, listNutrition, createNutrition, deleteNutrition };
}
