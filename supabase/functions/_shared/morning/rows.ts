/**
 * Defensive parsing of `svc_wake_candidates` rows (PostgREST JSON) into WakeCandidate.
 * Pure (no supabase-js), so it is unit-tested under node.
 */
import { asRow } from '../db/rows.ts';
import { DEFAULT_TZ } from '../dates.ts';
import type { NightRow, WakeCandidate } from './plan.ts';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function nightsOf(value: unknown): NightRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const r = asRow(raw);
    const date = text(r.date)?.slice(0, 10) ?? null;
    if (!date) return [];
    return [{ date, source: text(r.source) ?? 'manual', start: text(r.start), end: text(r.end) }];
  });
}

export function toCandidate(raw: unknown): WakeCandidate | null {
  const r = asRow(raw);
  const userId = text(r.user_id);
  const today = text(r.local_date)?.slice(0, 10) ?? null;
  const nowMinutes = Number(r.local_minutes);
  if (!userId || !today || !Number.isFinite(nowMinutes)) return null;
  return {
    userId,
    timezone: text(r.timezone) ?? DEFAULT_TZ,
    today,
    nowMinutes,
    prefs: { ...asRow(r.prefs) },
    garmin: r.garmin === true,
    lastCheckAt: text(r.last_check_at),
    nights: nightsOf(r.nights),
  };
}
