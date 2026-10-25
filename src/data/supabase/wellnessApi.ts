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

import type { Repository } from '../repository';
import { assertNutrition } from '../demo/validation';
import { run, runOne, runVoid, type SupabaseCtx } from './base';
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

  async function upsertCheckin(draft: CheckinDraft): Promise<DailyCheckin> {
    const me = await ctx.userId();
    const row = await runOne<CheckinRow>(
      'upsertCheckin',
      client
        .from('daily_checkins')
        .upsert({ ...checkinDraftToRow(draft, me), updated_at: ctx.now() }, { onConflict: 'user_id,date' })
        .select('*')
        .single(),
      'No se ha podido guardar el check-in.',
    );
    return rowToCheckin(row);
  }

  async function listMetrics(range: DateRange): Promise<DailyMetrics[]> {
    const me = await ctx.userId();
    const rows = await run<MetricsRow[] | null>(
      'listMetrics',
      client
        .from('daily_metrics')
        .select('user_id,date,source,hrv_ms,resting_hr,sleep_hours,sleep_score,body_battery,training_readiness,vo2max,steps,stress_avg,training_status')
        .eq('user_id', me)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true }),
    );
    return (rows ?? []).map(rowToMetrics);
  }

  async function upsertMetrics(drafts: MetricsDraft[]): Promise<void> {
    if (drafts.length === 0) return;
    const me = await ctx.userId();
    const now = ctx.now();
    await runVoid(
      'upsertMetrics',
      client
        .from('daily_metrics')
        .upsert(
          drafts.map((d) => ({ ...metricsDraftToRow(d, me), updated_at: now })),
          { onConflict: 'user_id,date,source' },
        ),
    );
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
