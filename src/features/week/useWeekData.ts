import { addDays, todayISO, weekRange } from '@/domain/dates';
import { weekSummary, type WeekSummary } from '@/domain/load';
import type { PhaseInfo } from '@/domain/periodization';
import type { BusyBlock, ISODate, JointSession, LifeEvent, Profile, Race, UUID, WeekPlan, Workout } from '@/domain/types';
import { useAuth } from '@/data/context';
import { useBusyBlocks, useJointSessions, useLifeEvents, useProfile, useRaces, useWeekPlans, useWorkouts } from '@/data/queries';

import { recentWeeklyMinutes, weekPhaseOf } from './weekModel';

const RECENT_WEEKS = 4;

export interface WeekData {
  today: ISODate;
  myId: UUID | undefined;
  workouts: Workout[];
  lifeEvents: LifeEvent[];
  busyBlocks: BusyBlock[];
  jointSessions: JointSession[];
  races: Race[];
  profile: Profile | null;
  summary: WeekSummary;
  /** Periodization of the week with its override (Plan → General) applied; null until races load. */
  phase: PhaseInfo | null;
  /** The athlete's / coach's override for this week when it applies, else null. */
  weekPlan: WeekPlan | null;
  /** Weekly hours × the adjusted volume factor ("Objetivo"). */
  targetHours: number | null;
  recentMinutes: number[];
  /** Completed workouts of the 4 weeks before this one (planner ramp control). */
  history: Workout[];
  isLoading: boolean;
  error: unknown;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

/** Everything the Semana screen needs for one week. */
export function useWeekData(weekStart: ISODate): WeekData {
  const today = todayISO();
  const range = weekRange(weekStart);
  const { session } = useAuth();
  const workouts = useWorkouts(range);
  const history = useWorkouts({ from: addDays(weekStart, -7 * RECENT_WEEKS), to: addDays(weekStart, -1) });
  // Events that ended up to 14 days before the week still restrict it (illness return, injuries, other sports).
  const lifeEvents = useLifeEvents({ from: addDays(weekStart, -14), to: range.to });
  const busy = useBusyBlocks(range);
  const joint = useJointSessions(range);
  const races = useRaces();
  const profile = useProfile();
  const weekPlans = useWeekPlans(range);

  const all = [workouts, history, lifeEvents, busy, joint, races, profile, weekPlans];
  const list = workouts.data ?? [];
  const week = weekPhaseOf(weekStart, races.data, profile.data ?? null, weekPlans.data);

  return {
    today,
    myId: session?.userId,
    workouts: list,
    lifeEvents: lifeEvents.data ?? [],
    busyBlocks: busy.data ?? [],
    jointSessions: joint.data ?? [],
    races: races.data ?? [],
    profile: profile.data ?? null,
    summary: weekSummary(list, weekStart, today),
    phase: week.phase,
    weekPlan: week.plan,
    targetHours: week.targetHours,
    recentMinutes: recentWeeklyMinutes(history.data ?? [], weekStart, RECENT_WEEKS, addDays),
    history: (history.data ?? []).filter((w) => w.status === 'completed'),
    isLoading: workouts.isLoading,
    error: workouts.error,
    isRefreshing: all.some((q) => q.isRefetching),
    refresh: async () => {
      await Promise.all(all.map((q) => q.refetch()));
    },
  };
}
