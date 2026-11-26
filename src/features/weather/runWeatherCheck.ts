/**
 * One weather check (weekly or daily, `weatherChecks.ts`): forecast of the
 * athlete's city → the weather layer on the window (`domain/weatherPlan.ts`)
 * → at most one pending proposal for the athlete to review (never applied
 * here). Remembers on the device when each check ran, per account.
 * Best effort: without a city, a forecast or data it does nothing and tries
 * again on the next open.
 */
import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type { DateRange, PlanProposal, Profile } from '@/domain/types';
import { planForWeather } from '@/domain/weatherPlan';
import type { Repository } from '@/data/repository';
import { logger } from '@/lib/logger';
import { readJson, writeJson } from '@/lib/storage';

import {
  EMPTY_CHECK_STATE,
  afterCheck,
  coveredWorkoutIds,
  dueCheck,
  mayPropose,
  signatureOfProposal,
  staleWeatherProposals,
  weatherModel,
  type WeatherCheckState,
} from './weatherChecks';

export type WeatherCheckRepo = Pick<
  Repository,
  'getWeather' | 'listWorkouts' | 'listBusyBlocks' | 'listLifeEvents' | 'listJointSessions' | 'listProposals' | 'createProposal' | 'setProposalStatus'
>;

export type WeatherCheckOutcome = 'not_due' | 'no_forecast' | 'nothing' | 'blocked' | 'proposed';

export function weatherCheckKey(userId: string): string {
  return `rti.weather.checks.v1.user.${userId}`;
}

function minutesOf(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** Closes the out-of-date weather proposals; returns the list as it is now and their signatures. */
async function closeStale(repo: WeatherCheckRepo, proposals: PlanProposal[], today: string): Promise<{ proposals: PlanProposal[]; expired: string[] }> {
  const stale = staleWeatherProposals(proposals, today);
  await Promise.all(stale.map((p) => repo.setProposalStatus(p.id, 'discarded')));
  const ids = new Set(stale.map((p) => p.id));
  return {
    proposals: proposals.map((p) => (ids.has(p.id) ? { ...p, status: 'discarded' as const } : p)),
    expired: stale.map(signatureOfProposal),
  };
}

/** Runs the check that is due now for `profile` (with a city). */
export async function runWeatherCheck(repo: WeatherCheckRepo, userId: string, profile: Profile, now: Date = new Date()): Promise<WeatherCheckOutcome> {
  const today = todayISO(now);
  const key = weatherCheckKey(userId);
  const state: WeatherCheckState = { ...EMPTY_CHECK_STATE, ...(await readJson<Partial<WeatherCheckState>>(key, EMPTY_CHECK_STATE)) };
  const due = dueCheck(today, minutesOf(now), state);
  if (!due || !profile.weatherPlace || !repo.getWeather) return 'not_due';
  const forecast = await repo.getWeather();
  if (!forecast || forecast.hours.length === 0) return 'no_forecast';
  const until = due.scope === 'week' ? addDays(due.from, 6) : due.from;
  const window: DateRange = { from: addDays(due.from, -1), to: addDays(until, 1) };
  const [workouts, busyBlocks, lifeEvents, jointSessions, all] = await Promise.all([
    repo.listWorkouts(window),
    repo.listBusyBlocks(window),
    repo.listLifeEvents({ from: addDays(due.from, -14), to: until }),
    repo.listJointSessions(window),
    repo.listProposals(),
  ]);
  const { proposals, expired } = await closeStale(repo, all, today);
  const result = planForWeather({
    today: due.from,
    ...(due.from === today ? { nowMinutes: minutesOf(now) } : {}),
    until,
    weekWorkouts: workouts,
    profile,
    busyBlocks,
    lifeEvents,
    jointSessions,
    forecast,
    scope: due.scope,
    exclude: coveredWorkoutIds(proposals),
  });
  const next = afterCheck(state, due, today, expired);
  await writeJson(key, next);
  if (result.changes.length === 0) return 'nothing';
  if (!mayPropose(proposals, result.signature, today, next)) return 'blocked';
  await repo.createProposal({
    kind: 'replan',
    source: 'rules',
    weekStart: startOfWeek(due.from),
    summary: result.summary,
    changes: result.changes,
    model: weatherModel(due.scope, result.signature),
  });
  logger.info('weather: proposal created', { scope: due.scope, changes: result.changes.length });
  return 'proposed';
}
