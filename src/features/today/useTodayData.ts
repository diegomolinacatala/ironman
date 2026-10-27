import { addDays, todayISO } from '@/domain/dates';
import { nextRace, phaseFor, type PhaseInfo } from '@/domain/periodization';
import type { ISODate, JointSession, NutritionLog, PlanProposal, Race, UUID, Workout } from '@/domain/types';
import { useAuth } from '@/data/context';
import {
  useBriefing,
  useIntegrations,
  useJointSessions,
  useNotifications,
  useNutrition,
  useProfile,
  useProposals,
  useRaces,
  useSyncGarmin,
  useWorkouts,
} from '@/data/queries';
import { garminState } from '@/features/briefing/briefingModel';
import { logger } from '@/lib/logger';

import { pendingInvites, unreadCount, workoutsOn } from './selectors';
import { mealsOfDay } from './todayModel';

const JOINT_LOOKAHEAD_DAYS = 30;

export interface TodayData {
  today: ISODate;
  tomorrow: ISODate;
  myId: UUID | undefined;
  /** Profile display name (for the greeting), null while loading / unknown. */
  displayName: string | null;
  todayWorkouts: Workout[];
  tomorrowWorkouts: Workout[];
  jointSessions: JointSession[];
  invites: JointSession[];
  proposals: PlanProposal[];
  race: Race | null;
  /** False while races are still loading (avoid flashing the empty race chip). */
  racesReady: boolean;
  phase: PhaseInfo | null;
  /** Today's nutrition entries, in logging order. */
  meals: NutritionLog[];
  unread: number;
  isLoading: boolean;
  error: unknown;
  isRefreshing: boolean;
  /** Refetches everything and, when Garmin is connected, syncs it first. */
  refresh: () => Promise<void>;
}

/** Composes every query the Hoy screen needs. */
export function useTodayData(): TodayData {
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const { session } = useAuth();

  const workouts = useWorkouts({ from: today, to: tomorrow });
  const races = useRaces();
  const profile = useProfile();
  const nutrition = useNutrition({ from: today, to: today });
  const proposals = useProposals('pending');
  const joint = useJointSessions({ from: today, to: addDays(today, JOINT_LOOKAHEAD_DAYS) });
  const notifications = useNotifications();
  const integrations = useIntegrations();
  const briefing = useBriefing(today);
  const syncGarmin = useSyncGarmin();

  const all = [workouts, races, profile, nutrition, proposals, joint, notifications, integrations, briefing];
  const raceList = races.data ?? [];
  const sessions = joint.data ?? [];
  const garminConnected = garminState(integrations.data) === 'connected';

  const sync = async () => {
    if (!garminConnected) return;
    try {
      await syncGarmin.mutateAsync();
    } catch (error) {
      // A failed sync must not block the refresh; the integrations card shows the error.
      logger.warn('today: garmin sync failed', error);
    }
  };

  return {
    today,
    tomorrow,
    myId: session?.userId,
    displayName: profile.data?.displayName ?? null,
    todayWorkouts: workoutsOn(workouts.data ?? [], today),
    tomorrowWorkouts: workoutsOn(workouts.data ?? [], tomorrow),
    jointSessions: sessions,
    invites: pendingInvites(sessions, session?.userId, today),
    proposals: proposals.data ?? [],
    race: nextRace(raceList, today),
    racesReady: !races.isLoading,
    phase: raceList.length > 0 ? phaseFor(today, raceList) : null,
    meals: mealsOfDay(nutrition.data, today),
    unread: unreadCount(notifications.data),
    // Only the plan itself blocks its section; secondary cards degrade gracefully.
    isLoading: workouts.isLoading,
    error: workouts.error,
    isRefreshing: syncGarmin.isPending || all.some((q) => q.isRefetching),
    refresh: async () => {
      await sync();
      await Promise.all(all.map((q) => q.refetch()));
    },
  };
}
