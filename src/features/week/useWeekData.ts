import { addDays, todayISO, weekRange } from '@/domain/dates';
import { weekSummary, type WeekSummary } from '@/domain/load';
import { phaseFor, type PhaseInfo } from '@/domain/periodization';
import type { BusyBlock, ISODate, JointSession, LifeEvent, Profile, Race, UUID, Workout } from '@/domain/types';
import { useAuth } from '@/data/context';
import { useBusyBlocks, useJointSessions, useLifeEvents, useProfile, useRaces, useWorkouts } from '@/data/queries';

import { recentWeeklyMinutes } from './weekModel';

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
  phase: PhaseInfo | null;
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

  const all = [workouts, history, lifeEvents, busy, joint, races, profile];
  const raceList = races.data ?? [];
  const list = workouts.data ?? [];
  const phase = raceList.length > 0 ? phaseFor(weekStart, raceList) : null;
  const weeklyHours = profile.data?.availability.weeklyHoursTarget ?? null;

  return {
    today,
    myId: session?.userId,
    workouts: list,
    lifeEvents: lifeEvents.data ?? [],
    busyBlocks: busy.data ?? [],
    jointSessions: joint.data ?? [],
    races: raceList,
    profile: profile.data ?? null,
    summary: weekSummary(list, weekStart, today),
    phase,
    targetHours: weeklyHours != null ? weeklyHours * (phase?.volumeFactor ?? 1) : null,
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
