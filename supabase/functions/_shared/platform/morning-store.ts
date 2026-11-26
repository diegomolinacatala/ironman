/**
 * Wake-up sweep store over supabase-js (service role): the RPCs of
 * 20261126000300_wake_notification.sql (svc_wake_candidates, svc_send_morning_briefing,
 * svc_skip_morning_briefing, svc_record_wake_check).
 */
import type { WakeCandidate } from '../morning/plan.ts';
import { toCandidate } from '../morning/rows.ts';
import type { MorningStore } from '../morning/sweep.ts';
import { rowsOf, unwrap } from './db.ts';
import type { Db } from './db.ts';

export function createMorningStore(db: Db): MorningStore {
  return {
    async listCandidates(nowIso) {
      const rows = rowsOf(await db.rpc('svc_wake_candidates', { p_now: nowIso }), 'svc_wake_candidates');
      return rows.map(toCandidate).filter((c): c is WakeCandidate => c !== null);
    },
    async sendBriefing(input) {
      const data = unwrap(
        await db.rpc('svc_send_morning_briefing', {
          p_user: input.userId,
          p_date: input.date,
          p_reason: input.reason,
          p_sleep_end: input.sleepEnd,
          p_due_at: input.dueAt,
        }),
        'svc_send_morning_briefing',
      );
      return data === true;
    },
    async skipBriefing(userId, date) {
      const data = unwrap(await db.rpc('svc_skip_morning_briefing', { p_user: userId, p_date: date }), 'svc_skip_morning_briefing');
      return data === true;
    },
    async recordCheck(userId, date) {
      unwrap(await db.rpc('svc_record_wake_check', { p_user: userId, p_date: date }), 'svc_record_wake_check');
    },
  };
}
