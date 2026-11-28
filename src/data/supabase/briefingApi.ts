/**
 * Morning briefing on Supabase: the `briefings` row of the day (RLS: own
 * rows, read-only) and the `briefing` edge function that writes it with the
 * AI. With the AI off, or when it is unavailable / slow / out of quota, the
 * briefing is composed on the device from the athlete's own data
 * (`engine: 'rules'`) and kept on the device (`localBriefings.ts`) so
 * `getBriefing` keeps returning it until a server briefing replaces it.
 */
import { composeBriefing } from '@/domain/briefing';
import { INVITE_HORIZON_DAYS } from '@/domain/briefingSocial';
import { addDays, isISODate } from '@/domain/dates';
import { illnessOutcome, illnessSignal, type IllnessOutcome } from '@/domain/illness';
import { nextRace } from '@/domain/periodization';
import { STRESS_SLEEP, stressSleepSignal, type StressSleepSignal } from '@/domain/stressSleep';
import type {
  Briefing,
  DailyCheckin,
  DailyMetrics,
  IllnessAnswer,
  ISODate,
  JointSession,
  LifeEvent,
  Profile,
  Race,
  RaceDistance,
  Thresholds,
  WatchBrand,
} from '@/domain/types';
import type { WeatherForecast } from '@/domain/weather';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import { RepositoryError, type Repository } from '../repository';
import { invokeAiFunction } from './aiFunctions';
import { run, type SupabaseCtx } from './base';
import { isNetworkError } from './errors';
import { readLocalBriefing, removeLocalBriefing, saveLocalBriefing } from './localBriefings';
import { parseBriefing, rowToBriefing } from './mappersAi';
import { asString, isRecord } from './narrow';
import type { BriefingRow } from './rows';

export const BRIEFING_TIMEOUT_MS = 60_000;
/**
 * Last night + the previous nights: 7 for the HRV baseline, 28 for the illness signal
 * (domain/illness.ts), 28 before the three-day window for the stress-and-sleep signal.
 */
const METRICS_DAYS = STRESS_SLEEP.baselineMaxDays + STRESS_SLEEP.windowDays;
const BRIEFING_COLUMNS = 'user_id,date,headline,sleep_verdict,sleep_summary,script,focus,sleep,model,created_at,updated_at';

type BriefingMethods = Pick<Repository, 'getBriefing' | 'generateBriefing'>;
export type BriefingSourceRepo = Pick<Repository, 'getMyProfile' | 'listMetrics' | 'listWorkouts' | 'listRaces'> &
  Partial<Pick<Repository, 'listJointSessions' | 'getWeather' | 'listCheckins' | 'listLifeEvents'>>;

/**
 * The last days' check-ins: the morning answer to the illness question and the stress of the
 * stress-and-sleep signal (a bonus: never fails the briefing).
 */
async function recentCheckinsFor(repo: BriefingSourceRepo, date: ISODate): Promise<DailyCheckin[]> {
  if (!repo.listCheckins) return [];
  try {
    return await repo.listCheckins({ from: addDays(date, -STRESS_SLEEP.windowDays), to: date });
  } catch (error) {
    logger.warn('briefing: check-in unavailable for the local template', error instanceof RepositoryError ? error.code : error);
    return [];
  }
}

/** Exams around the day, for the stress-and-sleep signal (a bonus too). */
async function lifeEventsFor(repo: BriefingSourceRepo, date: ISODate): Promise<LifeEvent[]> {
  if (!repo.listLifeEvents) return [];
  try {
    return await repo.listLifeEvents({ from: addDays(date, -STRESS_SLEEP.examPeriodDays), to: addDays(date, STRESS_SLEEP.examPeriodDays) });
  } catch (error) {
    logger.info('briefing: life events unavailable for the local template', error instanceof RepositoryError ? error.code : error);
    return [];
  }
}

/** Stress costing sleep on `date` (device time zone), for the local briefing. */
export function briefingStressSleep(
  metrics: readonly DailyMetrics[],
  date: ISODate,
  checkins: readonly DailyCheckin[],
  lifeEvents: readonly LifeEvent[],
): StressSleepSignal | null {
  return stressSleepSignal({ today: date, metrics, checkins, lifeEvents });
}

/** Last night's illness signal with the morning answer, for the local briefing. */
export function briefingIllness(metrics: readonly DailyMetrics[], date: ISODate, answer: IllnessAnswer | null): IllnessOutcome | null {
  return illnessOutcome(illnessSignal(metrics, date), answer);
}

export interface BriefingDeps {
  ctx: SupabaseCtx;
  repo: BriefingSourceRepo;
  timeoutMs?: number;
}

/** Quedadas are a bonus: without them (or when they fail) the briefing is composed anyway. */
async function jointSessionsFor(repo: BriefingSourceRepo, date: ISODate): Promise<JointSession[] | null> {
  if (!repo.listJointSessions) return null;
  try {
    return await repo.listJointSessions({ from: date, to: addDays(date, INVITE_HORIZON_DAYS - 1) });
  } catch (error) {
    logger.warn('briefing: quedadas unavailable for the local template', error instanceof RepositoryError ? error.code : error);
    return null;
  }
}

/** What the local briefing needs to speak concrete targets: zones, race distance and the watch. */
export interface BriefingAthleteFields {
  thresholds?: Thresholds;
  /** Distance of the target race (what "ritmo de carrera" means). */
  raceDistance?: RaceDistance;
  watchBrand?: WatchBrand;
}

export function briefingAthleteFields(profile: Profile | null, race: Race | null): BriefingAthleteFields {
  return {
    ...(profile ? { thresholds: profile.thresholds } : {}),
    ...(race ? { raceDistance: race.distance } : {}),
    ...(profile?.watchBrand ? { watchBrand: profile.watchBrand } : {}),
  };
}

/** The weather is a bonus too: no city, no forecast or a failure → the briefing says nothing about it. */
async function forecastFor(repo: BriefingSourceRepo): Promise<WeatherForecast | null> {
  if (!repo.getWeather) return null;
  try {
    return await repo.getWeather();
  } catch (error) {
    logger.info('briefing: no weather for the local template', error instanceof RepositoryError ? error.code : error);
    return null;
  }
}

/** Composes the local ('rules') briefing from the athlete's data. */
export async function composeLocalBriefing(repo: BriefingSourceRepo, date: ISODate, now: Date): Promise<Briefing> {
  const tomorrow = addDays(date, 1);
  const [profile, metrics, workouts, races, joint, checkins, events] = await Promise.all([
    repo.getMyProfile(),
    repo.listMetrics({ from: addDays(date, -(METRICS_DAYS - 1)), to: date }),
    repo.listWorkouts({ from: date, to: tomorrow }),
    repo.listRaces(),
    jointSessionsFor(repo, date),
    recentCheckinsFor(repo, date),
    lifeEventsFor(repo, date),
  ]);
  const answer = checkins.find((c) => c.date === date)?.illnessAnswer ?? null;
  const race = nextRace(races, date);
  const forecast = profile?.weatherPlace ? await forecastFor(repo) : null;
  return composeBriefing({
    date,
    name: profile?.displayName ?? '',
    metrics,
    todayWorkouts: workouts.filter((w) => w.date === date),
    tomorrowWorkouts: workouts.filter((w) => w.date === tomorrow),
    race,
    now,
    illness: briefingIllness(metrics, date, answer),
    stressSleep: briefingStressSleep(metrics, date, checkins, events),
    ...briefingAthleteFields(profile, race),
    ...(profile && joint ? { social: { me: profile.id, jointSessions: joint } } : {}),
    ...(forecast ? { forecast } : {}),
  });
}

const MISSING_TABLE_CODES: readonly string[] = ['42P01', 'PGRST205'];

export function isMissingTable(error: unknown): boolean {
  if (!(error instanceof RepositoryError)) return false;
  const cause = isRecord(error.cause) ? asString(error.cause.code) : null;
  return cause !== null && MISSING_TABLE_CODES.includes(cause);
}

function assertDate(date: ISODate): void {
  if (!isISODate(date)) throw new RepositoryError('validation', 'La fecha del informe no es válida.');
}

export function briefingApi(deps: BriefingDeps): BriefingMethods {
  const { ctx, repo } = deps;

  /** The server row of `date`, or null when there is none (or no `briefings` table yet). */
  async function serverBriefing(me: string, date: ISODate): Promise<Briefing | null> {
    try {
      const row = await run<BriefingRow | null>(
        'getBriefing',
        ctx.client.from('briefings').select(BRIEFING_COLUMNS).eq('user_id', me).eq('date', date).maybeSingle(),
      );
      return row ? rowToBriefing(row) : null;
    } catch (error) {
      // No `briefings` table yet (v2 migration pending): behave as "not generated"; generating falls back locally.
      if (!isMissingTable(error)) throw error;
      logger.warn('briefings table unavailable');
      return null;
    }
  }

  /** Server row first (an AI briefing always wins), else the copy composed on this device. */
  async function getBriefing(date: ISODate): Promise<Briefing | null> {
    assertDate(date);
    const me = await ctx.userId();
    try {
      return (await serverBriefing(me, date)) ?? (await readLocalBriefing(me, date));
    } catch (error) {
      // Offline: the device copy is better than an error on the Hoy hero and the widget.
      const local = isNetworkError(error) ? await readLocalBriefing(me, date) : null;
      if (local) return local;
      throw error;
    }
  }

  /** A failed "Actualizar" keeps the AI briefing already stored instead of replacing it with the template. */
  async function keptOnFailedRefresh(me: string, date: ISODate): Promise<Briefing | null> {
    try {
      return await serverBriefing(me, date);
    } catch (error) {
      logger.warn('briefing: stored briefing unavailable after a failed refresh', error instanceof RepositoryError ? error.code : error);
      return null;
    }
  }

  async function generateBriefing(date: ISODate, opts: { refresh?: boolean } = {}): Promise<Briefing> {
    assertDate(date);
    const me = await ctx.userId();
    const local = async (): Promise<Briefing> => {
      const kept = opts.refresh === true ? await keptOnFailedRefresh(me, date) : null;
      if (kept) return kept;
      const briefing = await composeLocalBriefing(repo, date, new Date(ctx.now()));
      await saveLocalBriefing(me, briefing);
      return briefing;
    };
    if (!env.aiCoachEnabled) return local();
    const result = await invokeAiFunction(ctx, {
      name: 'briefing',
      body: { date, refresh: opts.refresh === true },
      timeoutMs: deps.timeoutMs ?? BRIEFING_TIMEOUT_MS,
      fallbackMessage: 'No hemos podido preparar tu informe. Inténtalo de nuevo.',
    });
    if (result.kind === 'fallback') {
      logger.warn('briefing: using the local template', result.reason);
      return local();
    }
    const briefing = parseBriefing(result.data, date, ctx.now());
    if (briefing) {
      // The server row now answers getBriefing; the device copy is no longer needed.
      await removeLocalBriefing(me, date);
      return briefing;
    }
    logger.warn('briefing: unexpected response, using the local template');
    return local();
  }

  return { getBriefing, generateBriefing };
}
