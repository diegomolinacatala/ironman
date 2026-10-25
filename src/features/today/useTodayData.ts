import { addDays, todayISO } from '@/domain/dates';
import { nextRace, phaseFor, type PhaseInfo } from '@/domain/periodization';
import { computeReadiness, type Readiness } from '@/domain/readiness';
import type { DailyCheckin, ISODate, JointSession, PlanProposal, Race, UUID, Workout } from '@/domain/types';
import { useAuth } from '@/data/context';
import {
  useCheckins,
  useJointSessions,
  useMetrics,
  useNotifications,
  useProposals,
  useRaces,
  useWorkouts,
} from '@/data/queries';

import { checkinFor, pendingInvites, unreadCount, workoutsOn } from './selectors';

/** Days of wellness history fed to readiness (baseline window). */
const WELLNESS_DAYS = 28;
const JOINT_LOOKAHEAD_DAYS = 30;

export interface TodayData {
  today: ISODate;
  tomorrow: ISODate;
  myId: UUID | undefined;
  todayWorkouts: Workout[];
  tomorrowWorkouts: Workout[];
  jointSessions: JointSession[];
  invites: JointSession[];
  proposals: PlanProposal[];
  race: Race | null;
  /** False while races are still loading (avoid flashing the empty race chip). */
  racesReady: boolean;
  phase: PhaseInfo | null;
  readiness: Readiness;
  checkin: DailyCheckin | null;
  unread: number;
  isLoading: boolean;
  error: unknown;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

/** Composes every query the Hoy screen needs. */
export function useTodayData(): TodayData {
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const { session } = useAuth();
  const wellness = { from: addDays(today, -(WELLNESS_DAYS - 1)), to: today };

  const workouts = useWorkouts({ from: today, to: tomorrow });
  const races = useRaces();
  const checkins = useCheckins(wellness);
  const metrics = useMetrics(wellness);
  const proposals = useProposals('pending');
  const joint = useJointSessions({ from: today, to: addDays(today, JOINT_LOOKAHEAD_DAYS) });
  const notifications = useNotifications();

  const all = [workouts, races, checkins, metrics, proposals, joint, notifications];
  const raceList = races.data ?? [];
  const checkin = checkinFor(checkins.data, today);
  const sessions = joint.data ?? [];

  return {
    today,
    tomorrow,
    myId: session?.userId,
    todayWorkouts: workoutsOn(workouts.data ?? [], today),
    tomorrowWorkouts: workoutsOn(workouts.data ?? [], tomorrow),
    jointSessions: sessions,
    invites: pendingInvites(sessions, session?.userId, today),
    proposals: proposals.data ?? [],
    race: nextRace(raceList, today),
    racesReady: !races.isLoading,
    phase: raceList.length > 0 ? phaseFor(today, raceList) : null,
    readiness: computeReadiness({ today, checkin, metrics: metrics.data ?? [] }),
    checkin,
    unread: unreadCount(notifications.data),
    // Only the plan itself blocks the screen; secondary cards degrade gracefully.
    isLoading: workouts.isLoading,
    error: workouts.error,
    isRefreshing: all.some((q) => q.isRefetching),
    refresh: async () => {
      await Promise.all(all.map((q) => q.refetch()));
    },
  };
}
