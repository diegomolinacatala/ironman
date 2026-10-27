/** BriefingStore over supabase-js (service role). Every query is scoped to `userId`. */
import type { BriefingStore } from '../briefing/ports.ts';
import { mapBriefing } from '../db/rows.ts';
import { unwrap } from './db.ts';
import type { Db } from './db.ts';

const COLS = 'date,headline,sleep_verdict,sleep_summary,script,focus,sleep,model,created_at';

export function createBriefingStore(db: Db): BriefingStore {
  return {
    async getBriefing(userId, date) {
      const data = unwrap(await db.from('briefings').select(COLS).eq('user_id', userId).eq('date', date).maybeSingle(), 'get briefing');
      return data ? mapBriefing(data) : null;
    },
    async upsertBriefing(userId, row) {
      const data = unwrap(
        await db
          .from('briefings')
          .upsert(
            {
              user_id: userId,
              date: row.date,
              headline: row.headline,
              sleep_verdict: row.sleepVerdict,
              sleep_summary: row.sleepSummary,
              script: row.script,
              focus: row.focus,
              sleep: row.sleep,
              model: row.model,
              created_at: row.createdAt,
            },
            { onConflict: 'user_id,date' },
          )
          .select(COLS)
          .single(),
        'upsert briefing',
      );
      return mapBriefing(data);
    },
  };
}
