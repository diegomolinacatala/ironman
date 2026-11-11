/**
 * The athlete block of the planning context: profile, thresholds, availability,
 * the watch they use and their zones with numbers (mirrored `athleteZones`),
 * compact so the coach and Claude can copy targets instead of inventing them.
 */
import { WEEKDAYS_ES } from '../dates.ts';
import type { Availability, Profile, RaceDistance, Thresholds, WatchBrand } from '../types.ts';
import { athleteZones, targetParts } from './domain/zones.ts';
import type { ZoneRow } from './domain/zones.ts';

/** Zone name → "145–151 ppm · 5:08–5:48 /km · RPE 3–4" for one sport. */
export type SportZones = Record<string, string>;

export interface ZonesView {
  run: SportZones;
  bike: SportZones;
  swim: SportZones;
  /** Threshold HR used per sport, ppm (`estimated` = from max HR, not a measured LTHR). */
  lthr: { run: number | null; bike: number | null; estimated: boolean };
  /** What the athlete still has to fill in Tú › Perfil for full numbers. */
  missing?: string[];
}

const dayNames = (days: readonly number[]): string[] => days.map((d) => WEEKDAYS_ES[d] ?? String(d));

function availabilityView(a: Availability): Record<string, unknown> {
  return {
    weeklyHoursTarget: a.weeklyHoursTarget,
    restDay: a.restDay == null ? null : WEEKDAYS_ES[a.restDay],
    longSessionDays: dayNames(a.longSessionDays),
    poolDays: a.poolDays.length ? dayNames(a.poolDays) : 'cualquier día',
    windows: a.windows.map((w) => ({ day: WEEKDAYS_ES[w.weekday], start: w.start, end: w.end })),
  };
}

function sportZones(rows: readonly ZoneRow[], sport: 'run' | 'bike' | 'swim'): SportZones {
  return Object.fromEntries(rows.map((r) => [r.zone, targetParts({ ...r, hrEstimated: false }, sport).join(' · ')]));
}

/** Z1–Z5 and race pace per sport with the athlete's numbers (race row for the target race distance). */
export function zonesView(thresholds: Thresholds, raceDistance: RaceDistance | null): ZonesView {
  const z = athleteZones(thresholds, { raceDistance });
  return {
    run: sportZones(z.run, 'run'),
    bike: sportZones(z.bike, 'bike'),
    swim: sportZones(z.swim, 'swim'),
    lthr: z.lthr,
    ...(z.missing.length > 0 ? { missing: z.missing } : {}),
  };
}

/** The athlete's watch (not chosen yet = Garmin, as in the app). */
export function watchBrandOf(p: Pick<Profile, 'watchBrand'>): WatchBrand {
  return p.watchBrand ?? 'garmin';
}

export function athleteView(p: Profile, raceDistance: RaceDistance | null): Record<string, unknown> {
  return {
    name: p.displayName,
    username: p.username,
    level: p.level,
    sports: p.sports,
    thresholds: p.thresholds,
    zones: zonesView(p.thresholds, raceDistance),
    watchBrand: watchBrandOf(p),
    availability: availabilityView(p.availability),
    coachNotes: p.coachNotes,
  };
}
