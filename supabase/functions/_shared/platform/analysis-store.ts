/** AnalysisStore over supabase-js (service role). Every query is scoped to `userId`. */
import type { AnalysisStore } from '../analysis/http.ts';
import { mapWorkoutAnalysis } from '../db/rows.ts';
import { unwrap } from './db.ts';
import type { Db } from './db.ts';

const COLS = 'workout_id,headline,went_well,improve,next_step,created_at';

export function createAnalysisStore(db: Db): AnalysisStore {
  return {
    async getAnalysis(userId, workoutId) {
      const data = unwrap(
        await db.from('workout_analyses').select(COLS).eq('user_id', userId).eq('workout_id', workoutId).maybeSingle(),
        'get workout analysis',
      );
      return data ? mapWorkoutAnalysis(data) : null;
    },
    async upsertAnalysis(userId, analysis, model) {
      const data = unwrap(
        await db
          .from('workout_analyses')
          .upsert(
            {
              workout_id: analysis.workoutId,
              user_id: userId,
              headline: analysis.headline,
              went_well: analysis.wentWell,
              improve: analysis.improve,
              next_step: analysis.nextStep,
              model,
              created_at: analysis.createdAt,
            },
            { onConflict: 'workout_id' },
          )
          .select(COLS)
          .single(),
        'upsert workout analysis',
      );
      return mapWorkoutAnalysis(data);
    },
  };
}
