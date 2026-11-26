import { router } from 'expo-router';

import { addDays } from '@/domain/dates';
import { generateWeek } from '@/domain/planner';
import type { ISODate, PlanChange } from '@/domain/types';
import type { WeatherForecast } from '@/domain/weather';
import { weatherAdjustPlan } from '@/domain/weatherWeek';
import { useCreateProposal, useFetchFriendWeeks, useFriends, useWeather } from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';

import { weatherModel } from '@/features/weather/weatherChecks';
import { splitFriends } from '@/features/social/friendModel';
import { notify } from '@/features/workouts/confirm';

import { MAX_SOCIAL_FRIENDS, socialPriority, withSocial, type FriendWeek } from './socialPlan';

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

interface PlannedWeek {
  changes: PlanChange[];
  summary: string;
  model?: string;
}

/**
 * The weather layer on top of the planner's week (city set and forecast loaded): new sessions
 * that fall in the rain are placed in a dry gap or indoors, existing ones get their own change.
 */
export function withWeather(planned: PlannedWeek, weekStart: ISODate, data: WeekData, forecast: WeatherForecast | null, nowMinutes: number): PlannedWeek {
  if (!forecast || !data.profile?.weatherPlace || planned.changes.length === 0) return planned;
  const from = weekStart <= data.today ? data.today : weekStart;
  const adjusted = weatherAdjustPlan({
    today: from,
    ...(from === data.today ? { nowMinutes } : {}),
    until: addDays(weekStart, 6),
    profile: data.profile,
    busyBlocks: data.busyBlocks,
    lifeEvents: data.lifeEvents,
    jointSessions: data.jointSessions,
    races: data.races,
    forecast,
    existing: data.workouts,
    planned: planned.changes,
    userId: data.myId ?? 'me',
  });
  if (!adjusted.signature) return planned;
  return { changes: adjusted.changes, summary: `${planned.summary} ${adjusted.note}`.trim(), model: weatherModel('plan', adjusted.signature) };
}

export function usePlanWeek(): { plan: (weekStart: ISODate, data: WeekData) => Promise<void>; busy: boolean } {
  const create = useCreateProposal();
  const forecast = useWeather().data ?? null;
  const friends = useFriends().data;
  const fetchFriendWeeks = useFetchFriendWeeks();

  /** «Tu semana» con gente / un poco de todo: the friends' weeks for their common slots (else none is loaded). */
  const friendWeeks = async (weekStart: ISODate, data: WeekData): Promise<FriendWeek[]> => {
    if (!socialPriority(data.profile, weekStart)) return [];
    const accepted = splitFriends(friends).accepted.slice(0, MAX_SOCIAL_FRIENDS);
    const items = await fetchFriendWeeks(accepted.map((f) => f.profile.id), { from: weekStart, to: addDays(weekStart, 6) });
    return accepted.map((f, i) => ({ friendId: f.profile.id, displayName: f.profile.displayName, items: items[i] ?? [] }));
  };

  const plan = async (weekStart: ISODate, data: WeekData) => {
    if (!data.profile) {
      notify('Completa tu perfil', 'Necesitamos tus deportes y tu nivel para planificar la semana.');
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
        // The athlete's volume today decides a short-notice plan, like Plan → General.
        fitnessWeeklyMinutes: data.fitnessMinutes,
        // Current week: never add sessions to days that already passed.
        ...(weekStart <= data.today ? { today: data.today, nowMinutes: minutesNow() } : {}),
        history: data.history,
        // Plan → General: carga / más volumen / descarga / semana libre and its hours.
        weekPlan: data.weekPlan,
        // A stressful day (check-in stress ≥ 4) slows the ramp like a stress event.
        checkinStress: data.checkinStress ?? null,
      });
      if (result.changes.length === 0) {
        notify('Tu semana ya está completa', result.summary || 'No quedan huecos libres en tu calendario que rellenar.');
        return;
      }
      // «Tu semana» con gente: new sessions into the friends' common slots (named, never sent).
      const social = withSocial({ changes: result.changes, summary: result.summary }, weekStart, data, await friendWeeks(weekStart, data));
      // Weather is a layer on the planner's week: the athlete still reviews every change.
      const week = withWeather(social, weekStart, data, forecast, minutesNow());
      const proposal = await create.mutateAsync({
        kind: 'generate_week',
        source: 'rules',
        weekStart,
        summary: week.summary,
        changes: week.changes,
        ...(week.model ? { model: week.model } : {}),
      });
      router.push(`/proposal/${proposal.id}`);
    } catch (error) {
      logger.warn('plan week failed', error);
      notify('No se pudo planificar', errorMessage(error));
    }
  };

  return { plan, busy: create.isPending };
}
