/**
 * What the screens show while a change waits on the phone: the queued «Hecho» and
 * check-ins laid over the data from the server (`useWorkouts`, `useWorkout`,
 * `useCheckins` select through these), so the optimistic state survives refetches
 * and app restarts until the change is sent. Pure; returns the same object when
 * nothing applies, so memoised screens do not re-render for nothing.
 */
import type { DailyCheckin, DateRange, UUID, Workout } from '@/domain/types';

import type { OfflineItem } from './offlineQueue';
import { checkinOf, completedWorkout } from './offlineSync';

function pendingCompletions(items: readonly OfflineItem[]): Map<UUID, Extract<OfflineItem, { kind: 'complete' }>> {
  const map = new Map<UUID, Extract<OfflineItem, { kind: 'complete' }>>();
  for (const item of items) if (item.kind === 'complete') map.set(item.workoutId, item);
  return map;
}

export function withPendingCompletions(workouts: Workout[], items: readonly OfflineItem[]): Workout[] {
  const pending = pendingCompletions(items);
  if (pending.size === 0 || !workouts.some((w) => pending.has(w.id))) return workouts;
  return workouts.map((w) => {
    const item = pending.get(w.id);
    return item ? completedWorkout(w, item.data) : w;
  });
}

export function withPendingCompletion(workout: Workout | null, items: readonly OfflineItem[]): Workout | null {
  if (!workout) return workout;
  const item = pendingCompletions(items).get(workout.id);
  return item ? completedWorkout(workout, item.data) : workout;
}

/** Check-ins of `range` with the ones waiting on the phone (they replace the server's row of that day). */
export function withPendingCheckins(checkins: DailyCheckin[], items: readonly OfflineItem[], range: DateRange, userId: UUID): DailyCheckin[] {
  const pending = items.flatMap((item) =>
    item.kind === 'checkin' && item.draft.date >= range.from && item.draft.date <= range.to ? [checkinOf(userId, item.draft)] : [],
  );
  if (pending.length === 0) return checkins;
  const dates = new Set(pending.map((c) => c.date));
  return [...checkins.filter((c) => !dates.has(c.date)), ...pending].sort((a, b) => a.date.localeCompare(b.date));
}
