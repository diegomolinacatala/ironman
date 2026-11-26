import { addDays, startOfWeek } from '@/domain/dates';
import { replanForPlaces } from '@/domain/placesReplan';
import type { ISODate, Profile } from '@/domain/types';
import { useBusyBlocks, useCreateProposal, useJointSessions, useLifeEvents, useRaces, useWorkouts } from '@/data/queries';
import { logger } from '@/lib/logger';

const EVENTS_BACK_DAYS = 14;

/**
 * After «Sí, vuelvo este finde»: the planned sessions of those days fitted to the gear there
 * (`replanForPlaces`), stored as a pending proposal that Hoy shows in its banners for review.
 * Nothing is applied here; no proposal when nothing changes.
 */
export function usePlacesReplan(today: ISODate): { run: (profile: Profile, dates: readonly ISODate[]) => Promise<number> } {
  const range = { from: today, to: addDays(today, 6) };
  const workouts = useWorkouts(range);
  const busyBlocks = useBusyBlocks(range);
  const joint = useJointSessions(range);
  const lifeEvents = useLifeEvents({ from: addDays(today, -EVENTS_BACK_DAYS), to: range.to });
  const races = useRaces();
  const create = useCreateProposal();

  const run = async (profile: Profile, dates: readonly ISODate[]): Promise<number> => {
    try {
      const result = replanForPlaces({
        today,
        weekWorkouts: workouts.data ?? [],
        profile,
        busyBlocks: busyBlocks.data ?? [],
        lifeEvents: lifeEvents.data ?? [],
        jointSessions: joint.data ?? [],
        races: races.data ?? [],
        dates,
      });
      if (result.changes.length === 0) return 0;
      await create.mutateAsync({ kind: 'replan', source: 'rules', weekStart: startOfWeek(today), summary: result.summary, changes: result.changes });
      return result.changes.length;
    } catch (error) {
      logger.warn('places replan failed', error);
      return 0;
    }
  };

  return { run };
}
