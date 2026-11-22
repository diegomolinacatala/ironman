import { router } from 'expo-router';
import { useState } from 'react';

import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import { REPLAN_WINDOW_DAYS, replanForEvent } from '@/domain/replanner';
import type { DateRange, ISODate, LifeEvent } from '@/domain/types';
import { useBusyBlocks, useCreateProposal, useJointSessions, useLifeEvents, useProfile, useRaces, useWeekPlans, useWorkouts } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';

export interface ReplanState {
  /** Runs the rules engine and opens the proposal; returns a message when nothing changes. */
  run: () => Promise<void>;
  busy: boolean;
  ready: boolean;
  /** Inline result message (no changes needed / error). */
  message: string | null;
}

/** Events that ended up to 14 days before still restrict the window (illness return, injuries, other sports). */
const EVENT_LOOKBACK_DAYS = 14;

export interface ReplanWindow {
  /** `today` for the engine: the real today, or the Monday of a future week. */
  replanToday: ISODate;
  /** Monday of the week the proposal belongs to. */
  weekStart: ISODate;
  /**
   * What to load: from that week's Monday (its completed sessions count for
   * the weekly load) to replanToday + 13, which covers the editable window
   * (replanToday..+6), its neighbours and every move target.
   */
  range: DateRange;
}

/** Window of an imprevisto's re-plan (pure, for tests). */
export function replanWindowFor(event: Pick<LifeEvent, 'startDate'>, today: ISODate): ReplanWindow {
  const anchor = event.startDate > today ? event.startDate : today;
  const weekStart = startOfWeek(anchor);
  // The engine edits [today, today + 6]; for a future week start that window on its Monday.
  const replanToday = weekStart > today ? weekStart : today;
  return { replanToday, weekStart, range: { from: startOfWeek(replanToday), to: addDays(replanToday, REPLAN_WINDOW_DAYS * 2 - 1) } };
}

/** Re-plans the week affected by `event` with the offline rules engine. */
export function useReplanForEvent(event: LifeEvent): ReplanState {
  const { replanToday, weekStart, range } = replanWindowFor(event, todayISO());
  const workouts = useWorkouts(range);
  const busyBlocks = useBusyBlocks(range);
  const lifeEvents = useLifeEvents({ from: addDays(range.from, -EVENT_LOOKBACK_DAYS), to: range.to });
  const profile = useProfile();
  const joint = useJointSessions(range);
  const races = useRaces();
  const weekPlans = useWeekPlans(range);
  const create = useCreateProposal();
  const [message, setMessage] = useState<string | null>(null);
  const queries = [workouts, busyBlocks, lifeEvents, profile, joint, races, weekPlans];

  const run = async () => {
    if (!profile.data) {
      setMessage('Completa tu perfil para poder reorganizar la semana.');
      return;
    }
    setMessage(null);
    try {
      const others = (lifeEvents.data ?? []).filter((e) => e.id !== event.id);
      const result = replanForEvent({
        today: replanToday,
        weekWorkouts: workouts.data ?? [],
        profile: profile.data,
        busyBlocks: busyBlocks.data ?? [],
        jointSessions: joint.data ?? [],
        races: races.data ?? [],
        lifeEvents: [...others, event],
        weekPlan: (weekPlans.data ?? []).find((p) => p.weekStart === startOfWeek(replanToday)) ?? null,
        event,
      });
      if (result.failures.length > 0) logger.warn('replan for event: changes left out', result.failures);
      if (result.changes.length === 0) {
        setMessage(result.summary || 'Tu semana ya encaja con este imprevisto: no hace falta cambiar nada.');
        return;
      }
      const proposal = await create.mutateAsync({
        kind: 'replan',
        source: 'rules',
        weekStart,
        summary: result.summary,
        changes: result.changes,
      });
      router.replace(`/proposal/${proposal.id}`);
    } catch (error) {
      logger.warn('replan for event failed', error);
      setMessage(errorMessage(error, 'No se pudo reorganizar la semana. Inténtalo de nuevo.'));
    }
  };

  return {
    run,
    busy: create.isPending,
    // Every input of the engine: a replan without busy blocks or quedadas would propose clashes.
    ready: queries.every((q) => !q.isLoading),
    message,
  };
}
