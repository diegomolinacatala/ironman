/**
 * Post-workout analysis on Supabase: the `workout_analyses` row (RLS: own
 * rows, read-only) and the `analysis` edge function that writes it with the
 * AI. `analyzeWorkout` resolves to null when the AI is off or unavailable;
 * the screen then shows the rules analysis (`domain/workoutAnalysis`).
 */
import { isISODate } from '@/domain/dates';
import type { ISODate, UUID, WorkoutAnalysis } from '@/domain/types';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import { invokeAiFunction } from './aiFunctions';
import { run, type SupabaseCtx } from './base';
import { isMissingTable } from './briefingApi';
import { parseWorkoutAnalysis } from './mappersAi';

export const ANALYSIS_TIMEOUT_MS = 50_000;
const COLUMNS = 'workout_id,headline,went_well,improve,next_step,created_at';

type AnalysisMethods = Pick<Repository, 'getWorkoutAnalysis' | 'analyzeWorkout'>;

export function analysisApi(ctx: SupabaseCtx, timeoutMs = ANALYSIS_TIMEOUT_MS): AnalysisMethods {
  async function getWorkoutAnalysis(workoutId: UUID): Promise<WorkoutAnalysis | null> {
    const me = await ctx.userId();
    try {
      const row = await run<unknown>(
        'getWorkoutAnalysis',
        ctx.client.from('workout_analyses').select(COLUMNS).eq('user_id', me).eq('workout_id', workoutId).maybeSingle(),
      );
      return row ? parseWorkoutAnalysis(row) : null;
    } catch (error) {
      // No table yet (migration pending): behave as "not analysed".
      if (!isMissingTable(error)) throw error;
      logger.warn('workout_analyses table unavailable');
      return null;
    }
  }

  async function analyzeWorkout(input: { workoutId: UUID; date: ISODate; refresh?: boolean }): Promise<WorkoutAnalysis | null> {
    if (!isISODate(input.date)) throw new RepositoryError('validation', 'La fecha del entreno no es válida.');
    if (!env.aiCoachEnabled) return null;
    const result = await invokeAiFunction(ctx, {
      name: 'analysis',
      body: { workoutId: input.workoutId, date: input.date, ...(input.refresh ? { refresh: true } : {}) },
      timeoutMs,
      fallbackMessage: 'No hemos podido analizar el entreno. Inténtalo de nuevo.',
    });
    if (result.kind === 'fallback') {
      logger.warn('analysis: using the rules analysis', result.reason);
      return null;
    }
    const analysis = parseWorkoutAnalysis(result.data);
    if (!analysis) logger.warn('analysis: unexpected response, using the rules analysis');
    return analysis;
  }

  return { getWorkoutAnalysis, analyzeWorkout };
}
