import type { CheckinDraft, DailyCheckin, DailyMetrics, DateRange, MetricsDraft, NutritionDraft, NutritionLog, UUID } from '@/domain/types';

import type { Repository } from '../../repository';
import { assertNutrition } from '../validation';
import { inRange, requireMe, type DemoDeps } from './common';

type WellnessMethods = Pick<
  Repository,
  'listCheckins' | 'upsertCheckin' | 'listMetrics' | 'upsertMetrics' | 'listNutrition' | 'createNutrition' | 'deleteNutrition'
>;

const byDate = <T extends { date: string }>(a: T, b: T): number => a.date.localeCompare(b.date);

export function wellnessDemo({ store }: DemoDeps): WellnessMethods {
  return {
    async listCheckins(range: DateRange): Promise<DailyCheckin[]> {
      const me = await requireMe(store);
      return (await store.read()).checkins.filter((c) => c.userId === me && inRange(c.date, range)).sort(byDate);
    },
    async upsertCheckin(draft: CheckinDraft): Promise<DailyCheckin> {
      const me = await requireMe(store);
      return store.update((db) => {
        const checkin: DailyCheckin = { ...draft, userId: me };
        const others = db.checkins.filter((c) => !(c.userId === me && c.date === draft.date));
        return { db: { ...db, checkins: [...others, checkin] }, result: checkin };
      });
    },
    async listMetrics(range: DateRange): Promise<DailyMetrics[]> {
      const me = await requireMe(store);
      return (await store.read()).metrics.filter((m) => m.userId === me && inRange(m.date, range)).sort(byDate);
    },
    async upsertMetrics(drafts: MetricsDraft[]): Promise<void> {
      if (drafts.length === 0) return;
      const me = await requireMe(store);
      await store.update((db) => {
        const incoming = drafts.map((d) => ({ ...d, userId: me }));
        const key = (m: { date: string; source: string }) => `${m.date}|${m.source}`;
        const replaced = new Set(incoming.map(key));
        const kept = db.metrics.filter((m) => !(m.userId === me && replaced.has(key(m))));
        return { db: { ...db, metrics: [...kept, ...incoming] }, result: undefined };
      });
    },
    async listNutrition(range: DateRange): Promise<NutritionLog[]> {
      const me = await requireMe(store);
      return (await store.read()).nutrition
        .filter((n) => n.userId === me && inRange(n.date, range))
        .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : byDate(a, b)));
    },
    async createNutrition(draft: NutritionDraft): Promise<NutritionLog> {
      assertNutrition(draft);
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const log: NutritionLog = {
          id: clock.newId(),
          userId: me,
          date: draft.date,
          meal: draft.meal,
          description: draft.description.trim(),
          kcal: draft.kcal ?? null,
          carbsG: draft.carbsG ?? null,
          proteinG: draft.proteinG ?? null,
          fatG: draft.fatG ?? null,
          createdAt: clock.now,
        };
        return { db: { ...db, nutrition: [...db.nutrition, log] }, result: log };
      });
    },
    async deleteNutrition(id: UUID): Promise<void> {
      const me = await requireMe(store);
      await store.update((db) => ({ db: { ...db, nutrition: db.nutrition.filter((n) => !(n.id === id && n.userId === me)) }, result: undefined }));
    },
  };
}
