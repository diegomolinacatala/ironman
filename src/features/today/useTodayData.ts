import { addDays, todayISO } from '@/domain/dates';
import { nextRace, phaseFor, type PhaseInfo } from '@/domain/periodization';
import type { ISODate, JointSession, NutritionLog, PlanProposal, Race, RaceDistance, Thresholds, UUID, Workout } from '@/domain/types';
import { useAuth } from '@/data/context';
import {
  useBriefing,
  useCheckins,
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
import { useHealthIntegration } from '@/integrations/hooks';
import { logger } from '@/lib/logger';

import { checkinFor, pendingInvites, unreadCount, workoutsOn } from './selectors';
import { mealsOfDay, refreshSyncFor, type RefreshSync } from './todayModel';

const JOINT_LOOKAHEAD_DAYS = 30;

export interface TodayData {
  today: ISODate;
  tomorrow: ISODate;
  myId: UUID | undefined;
  /** Profile display name (for the greeting), null while loading / unknown. */
  displayName: string | null;
  /** The athlete's thresholds (targets in ppm / pace / watts), null while loading. */
  thresholds: Thresholds | null;
  /** Distance of the next target race (what "ritmo de carrera" means). */
  raceDistance: RaceDistance | null;
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
  /** Today's check-in is already saved. */
  checkinDone: boolean;
  unread: number;
  isLoading: boolean;
  error: unknown;
  isRefreshing: boolean;
  /** Pulls the watch data first (Garmin, or Apple Salud for COROS), then refetches everything. */
  refresh: () => Promise<void>;
}

/** Runs the watch sync for pull-to-refresh; a failure never blocks the refetch (the connection cards show it). */
async function runSync(source: RefreshSync, garmin: () => Promise<unknown>, health: () => Promise<unknown>): Promise<void> {
  if (!source) return;
  try {
    await (source === 'garmin' ? garmin() : health());
  } catch (error) {
    logger.warn(`today: ${source} sync failed`, error);
  }
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
  const checkins = useCheckins({ from: today, to: today });
  const syncGarmin = useSyncGarmin();
  const health = useHealthIntegration();

  const all = [workouts, races, profile, nutrition, proposals, joint, notifications, integrations, briefing, checkins];
  const raceList = races.data ?? [];
  const sessions = joint.data ?? [];
  const race = nextRace(raceList, today);
  const source = refreshSyncFor({
    watchBrand: profile.data?.watchBrand,
    garminConnected: garminState(integrations.data) === 'connected',
    healthReady: health.available && health.enabled,
  });

  return {
    today,
    tomorrow,
    myId: session?.userId,
    displayName: profile.data?.displayName ?? null,
    thresholds: profile.data?.thresholds ?? null,
    raceDistance: race?.distance ?? null,
    todayWorkouts: workoutsOn(workouts.data ?? [], today),
    tomorrowWorkouts: workoutsOn(workouts.data ?? [], tomorrow),
    jointSessions: sessions,
    invites: pendingInvites(sessions, session?.userId, today),
    proposals: proposals.data ?? [],
    race,
    racesReady: !races.isLoading,
    phase: raceList.length > 0 ? phaseFor(today, raceList) : null,
    meals: mealsOfDay(nutrition.data, today),
    checkinDone: checkinFor(checkins.data, today) != null,
    unread: unreadCount(notifications.data),
    // Only the plan itself blocks its section; secondary cards degrade gracefully.
    isLoading: workouts.isLoading,
    error: workouts.error,
    isRefreshing: syncGarmin.isPending || health.busy || all.some((q) => q.isRefetching),
    refresh: async () => {
      await runSync(source, () => syncGarmin.mutateAsync(), () => health.syncNow());
      await Promise.all(all.map((q) => q.refetch()));
    },
  };
}
