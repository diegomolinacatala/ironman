/**
 * Device copy of the briefings composed locally on the Supabase backend (AI
 * off or unavailable). The `briefings` table has no client writes, so without
 * this a local briefing would vanish on the next refetch (focus, realtime) and
 * the widget would lose its headline. One AsyncStorage key per user holding a
 * date → Briefing map, pruned to the last 7 days. A server row always wins.
 */
import { addDays, isISODate } from '@/domain/dates';
import type { Briefing, ISODate, UUID } from '@/domain/types';
import { readJson, removeKey, writeJson } from '@/lib/storage';

import { parseBriefing } from './mappersAi';
import { isRecord } from './narrow';

const KEY_PREFIX = 'rti.briefings.local.v1.';
/** Days kept, counting back from the newest stored date. */
export const LOCAL_BRIEFING_DAYS = 7;

type StoredBriefings = Record<ISODate, unknown>;

export function localBriefingsKey(userId: UUID): string {
  return `${KEY_PREFIX}${userId}`;
}

async function readAll(userId: UUID): Promise<StoredBriefings> {
  const stored = await readJson<unknown>(localBriefingsKey(userId), null);
  return isRecord(stored) ? stored : {};
}

function prune(entries: StoredBriefings): StoredBriefings {
  const dates = Object.keys(entries).filter(isISODate).sort();
  const newest = dates[dates.length - 1];
  if (!newest) return {};
  const cutoff = addDays(newest, -(LOCAL_BRIEFING_DAYS - 1));
  return Object.fromEntries(dates.filter((d) => d >= cutoff).map((d) => [d, entries[d]]));
}

/** The locally composed briefing of `date`, validated like a server response; null if none. */
export async function readLocalBriefing(userId: UUID, date: ISODate): Promise<Briefing | null> {
  const value = (await readAll(userId))[date];
  if (value === undefined) return null;
  const briefing = parseBriefing(value, date, new Date(0).toISOString());
  return briefing && briefing.date === date ? briefing : null;
}

export async function saveLocalBriefing(userId: UUID, briefing: Briefing): Promise<void> {
  const entries = await readAll(userId);
  await writeJson(localBriefingsKey(userId), prune({ ...entries, [briefing.date]: briefing }));
}

/** Drops the local copy of `date` (a server briefing replaced it). */
export async function removeLocalBriefing(userId: UUID, date: ISODate): Promise<void> {
  const entries = await readAll(userId);
  if (!(date in entries)) return;
  const rest = Object.fromEntries(Object.entries(entries).filter(([d]) => d !== date));
  await writeJson(localBriefingsKey(userId), rest);
}

/** Sign-out / account deletion: no sleep data left behind on the device. */
export async function clearLocalBriefings(userId: UUID): Promise<void> {
  await removeKey(localBriefingsKey(userId));
}
