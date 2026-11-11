/**
 * Demo season plan ("Plan → General"): week-level overrides kept in the demo
 * database, one per (athlete, Monday), with the same validation as Supabase.
 */
import type { DateRange, ISODate, WeekPlan, WeekPlanDraft } from '@/domain/types';

import type { Repository } from '../../repository';
import type { DemoWeekPlan } from '../db';
import { assertWeekStartDate, cleanWeekPlanDrafts } from '../validation';
import { inRange, requireMe, type DemoDeps } from './common';

type WeekPlanMethods = Pick<Repository, 'listWeekPlans' | 'saveWeekPlans' | 'deleteWeekPlan'>;

function stripPlan({ userId: _userId, ...plan }: DemoWeekPlan): WeekPlan {
  return plan;
}

function byWeek(a: WeekPlan, b: WeekPlan): number {
  return a.weekStart.localeCompare(b.weekStart);
}

export function weekPlansDemo({ store }: DemoDeps): WeekPlanMethods {
  return {
    async listWeekPlans(range: DateRange): Promise<WeekPlan[]> {
      const me = await requireMe(store);
      return (await store.read()).weekPlans
        .filter((p) => p.userId === me && inRange(p.weekStart, range))
        .map(stripPlan)
        .sort(byWeek);
    },

    async saveWeekPlans(drafts: WeekPlanDraft[]): Promise<WeekPlan[]> {
      const clean = cleanWeekPlanDrafts(drafts, store.clock().today);
      const me = await requireMe(store);
      if (clean.length === 0) return [];
      return store.update((db, clock) => {
        const saved: DemoWeekPlan[] = clean.map((d) => ({ ...d, userId: me, updatedAt: clock.now }));
        const weeks = new Set(saved.map((p) => p.weekStart));
        const kept = db.weekPlans.filter((p) => !(p.userId === me && weeks.has(p.weekStart)));
        return { db: { ...db, weekPlans: [...kept, ...saved] }, result: saved.map(stripPlan) };
      });
    },

    async deleteWeekPlan(weekStart: ISODate): Promise<void> {
      assertWeekStartDate(weekStart);
      const me = await requireMe(store);
      await store.update((db) => ({
        db: { ...db, weekPlans: db.weekPlans.filter((p) => !(p.userId === me && p.weekStart === weekStart)) },
        result: undefined,
      }));
    },
  };
}
