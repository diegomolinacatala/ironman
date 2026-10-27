/** Ports of the morning briefing: the `briefings` table and the on-demand Garmin refresh. */
import type { GarminCredential, SyncOutcome } from '../garmin/credentials.ts';
import type { Briefing, ISODate, ISODateTime, SleepSnapshot, SleepVerdict, UUID } from '../types.ts';

/** One `briefings` row (camelCase). */
export interface StoredBriefing {
  date: ISODate;
  headline: string;
  sleepVerdict: SleepVerdict;
  sleepSummary: string;
  script: string;
  focus: string;
  sleep: SleepSnapshot | null;
  model: string | null;
  createdAt: ISODateTime;
}

export interface BriefingStore {
  getBriefing(userId: UUID, date: ISODate): Promise<StoredBriefing | null>;
  /** Insert or replace the row of (user, date); returns what was stored. */
  upsertBriefing(userId: UUID, row: StoredBriefing): Promise<StoredBriefing>;
}

/** Garmin refresh before generating (credential lookup + `syncWithCredential`). */
export interface GarminRefresher {
  getCredential(userId: UUID): Promise<GarminCredential | null>;
  sync(credential: GarminCredential): Promise<SyncOutcome>;
}

/** Row → app `Briefing` (always `engine: 'ai'`: only the function writes rows). */
export function toBriefing(row: StoredBriefing): Briefing {
  return {
    date: row.date,
    headline: row.headline,
    sleepVerdict: row.sleepVerdict,
    sleepSummary: row.sleepSummary,
    script: row.script,
    focus: row.focus,
    sleep: row.sleep,
    engine: 'ai',
    createdAt: row.createdAt,
  };
}
