import { router } from 'expo-router';
import { useState } from 'react';

import { addDays, startOfWeek, todayISO, weekRange } from '@/domain/dates';
import { replanForEvent } from '@/domain/replanner';
import type { LifeEvent } from '@/domain/types';
import { useBusyBlocks, useCreateProposal, useJointSessions, useLifeEvents, useProfile, useRaces, useWorkouts } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';

export interface ReplanState {
  /** Runs the rules engine and opens the proposal; returns a message when nothing changes. */
  run: () => Promise<void>;
  busy: boolean;
  ready: boolean;
  /** Inline result message (no changes needed / error). */
  message: string | null;
}

/** Re-plans the week affected by `event` with the offline rules engine. */
export function useReplanForEvent(event: LifeEvent): ReplanState {
  const today = todayISO();
  const anchor = event.startDate > today ? event.startDate : today;
  const weekStart = startOfWeek(anchor);
  // The engine edits [today, today + 6]; for a future week start that window on its Monday.
  const replanToday = weekStart > today ? weekStart : today;
  const range = weekRange(weekStart);
  const workouts = useWorkouts(range);
  const busyBlocks = useBusyBlocks(range);
  // Events that ended up to 14 days before the week still restrict it (illness return, injuries, other sports).
  const lifeEvents = useLifeEvents({ from: addDays(weekStart, -14), to: range.to });
  const profile = useProfile();
  const joint = useJointSessions(range);
  const races = useRaces();
  const create = useCreateProposal();
  const [message, setMessage] = useState<string | null>(null);

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
        event,
      });
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
    ready: !workouts.isLoading && !profile.isLoading,
    message,
  };
}
