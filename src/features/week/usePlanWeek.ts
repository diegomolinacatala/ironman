import { router } from 'expo-router';

import { addDays } from '@/domain/dates';
import { generateWeek } from '@/domain/planner';
import type { ISODate } from '@/domain/types';
import { useCreateProposal } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';

import { notify } from '@/features/workouts/confirm';

import type { WeekData } from './useWeekData';

/**
 * "Planificar semana": runs the offline rules engine with the week's context,
 * stores the result as a pending proposal and opens the review screen.
 */
/** Local minutes since midnight: the planner skips slots that already passed today. */
function minutesNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function usePlanWeek(): { plan: (weekStart: ISODate, data: WeekData) => Promise<void>; busy: boolean } {
  const create = useCreateProposal();

  const plan = async (weekStart: ISODate, data: WeekData) => {
    if (!data.profile) {
      notify('Completa tu perfil', 'Necesitamos tu disponibilidad y deportes para planificar la semana.');
      return;
    }
    const weekEnd = addDays(weekStart, 6);
    if (weekEnd < data.today) {
      notify('Semana pasada', 'Solo se pueden planificar la semana actual y las siguientes.');
      return;
    }
    try {
      const result = generateWeek({
        weekStart,
        profile: data.profile,
        races: data.races,
        existing: data.workouts,
        lifeEvents: data.lifeEvents,
        busyBlocks: data.busyBlocks,
        jointSessions: data.jointSessions,
        readiness: null,
        recentWeeklyMinutes: data.recentMinutes,
        // Current week: never add sessions to days that already passed.
        ...(weekStart <= data.today ? { today: data.today, nowMinutes: minutesNow() } : {}),
        history: data.history,
      });
      if (result.changes.length === 0) {
        notify('Tu semana ya está completa', result.summary || 'No hay huecos libres que rellenar con tu disponibilidad actual.');
        return;
      }
      const proposal = await create.mutateAsync({
        kind: 'generate_week',
        source: 'rules',
        weekStart,
        summary: result.summary,
        changes: result.changes,
      });
      router.push(`/proposal/${proposal.id}`);
    } catch (error) {
      logger.warn('plan week failed', error);
      notify('No se pudo planificar', errorMessage(error));
    }
  };

  return { plan, busy: create.isPending };
}
