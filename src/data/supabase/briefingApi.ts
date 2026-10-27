/**
 * Morning briefing on Supabase: the `briefings` row of the day (RLS: own
 * rows, read-only) and the `briefing` edge function that writes it with the
 * AI. With the AI off, or when it is unavailable / slow / out of quota, the
 * briefing is composed on the device from the athlete's own data
 * (`engine: 'rules'`) and kept on the device (`localBriefings.ts`) so
 * `getBriefing` keeps returning it until a server briefing replaces it.
 */
import { composeBriefing } from '@/domain/briefing';
import { addDays, isISODate } from '@/domain/dates';
import { nextRace } from '@/domain/periodization';
import type { Briefing, ISODate } from '@/domain/types';
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
/** Last night + the 7 previous nights (HRV baseline). */
const METRICS_DAYS = 8;
const BRIEFING_COLUMNS = 'user_id,date,headline,sleep_verdict,sleep_summary,script,focus,sleep,model,created_at,updated_at';

type BriefingMethods = Pick<Repository, 'getBriefing' | 'generateBriefing'>;
export type BriefingSourceRepo = Pick<Repository, 'getMyProfile' | 'listMetrics' | 'listWorkouts' | 'listRaces'>;

export interface BriefingDeps {
  ctx: SupabaseCtx;
  repo: BriefingSourceRepo;
  timeoutMs?: number;
}

/** Composes the local ('rules') briefing from the athlete's data. */
export async function composeLocalBriefing(repo: BriefingSourceRepo, date: ISODate, now: Date): Promise<Briefing> {
  const tomorrow = addDays(date, 1);
  const [profile, metrics, workouts, races] = await Promise.all([
    repo.getMyProfile(),
    repo.listMetrics({ from: addDays(date, -(METRICS_DAYS - 1)), to: date }),
    repo.listWorkouts({ from: date, to: tomorrow }),
    repo.listRaces(),
  ]);
  return composeBriefing({
    date,
    name: profile?.displayName ?? '',
    metrics,
    todayWorkouts: workouts.filter((w) => w.date === date),
    tomorrowWorkouts: workouts.filter((w) => w.date === tomorrow),
    race: nextRace(races, date),
    now,
  });
}

const MISSING_TABLE_CODES: readonly string[] = ['42P01', 'PGRST205'];

function isMissingTable(error: unknown): boolean {
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
