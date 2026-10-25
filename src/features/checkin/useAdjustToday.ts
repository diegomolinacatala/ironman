import { router } from 'expo-router';
import { useState } from 'react';

import { addDays, startOfWeek, weekRange } from '@/domain/dates';
import type { Readiness } from '@/domain/readiness';
import { replanForReadiness } from '@/domain/replanner';
import type { ISODate } from '@/domain/types';
import { useBusyBlocks, useCreateProposal, useJointSessions, useLifeEvents, useProfile, useRaces, useWorkouts } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';

/** "Ajustar hoy": re-plans the current week for a low readiness and opens the proposal. */
export function useAdjustToday(date: ISODate): {
  run: (readiness: Readiness) => Promise<void>;
  busy: boolean;
  message: string | null;
} {
  const weekStart = startOfWeek(date);
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

  const run = async (readiness: Readiness) => {
    if (!profile.data) {
      setMessage('Completa tu perfil para poder ajustar el plan.');
      return;
    }
    setMessage(null);
    try {
      const result = replanForReadiness({
        today: date,
        weekWorkouts: workouts.data ?? [],
        profile: profile.data,
        busyBlocks: busyBlocks.data ?? [],
        jointSessions: joint.data ?? [],
        races: races.data ?? [],
        lifeEvents: lifeEvents.data ?? [],
        readiness,
      });
      if (result.changes.length === 0) {
        setMessage(result.summary || 'Hoy no tienes nada que ajustar. Escucha a tu cuerpo y ve suave.');
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
      logger.warn('adjust today failed', error);
      setMessage(errorMessage(error, 'No se pudo ajustar el plan. Inténtalo de nuevo.'));
    }
  };

  return { run, busy: create.isPending || workouts.isLoading, message };
}
