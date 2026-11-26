/**
 * The athlete's own week context on top of the imprevistos (pure, app only), read by the
 * planner and the re-planner:
 * - «Mis sitios»: the place of each day limits the sports (no bike, no pool) and decides
 *   rodillo or outside (`places.ts`);
 * - «Tu semana» (Sunday question): «muchas cosas» = −20 % of volume, one quality session less
 *   and weekday sessions of 75' at most; «más libre» = +10 % before the ramp caps
 *   (`weekVolumeBoost`, applied by the planner), which still apply.
 */
import { startOfWeek, weekdayOf } from './dates';
import { adaptDraftToPlace, placeRestrictionOn } from './places';
import { mergeRestrictions, NO_RESTRICTION, type DayRestriction } from './restrictions';
import type { ISODate, PlanChange, Profile } from './types';
import { answersFor, BUSY_WEEK_FACTOR, BUSY_WEEKDAY_MAX_MIN } from './weekQuestions';

type ContextProfile = Pick<Profile, 'places' | 'weekQuestions'>;

/** Restriction from the Sunday answer for `date` (null without one). */
export function weekLoadRestrictionOn(profile: ContextProfile, date: ISODate): Partial<DayRestriction> | null {
  const load = answersFor(profile, startOfWeek(date))?.load;
  if (load === 'busy') {
    const weekday = weekdayOf(date) <= 4;
    return {
      volumeFactor: BUSY_WEEK_FACTOR,
      qualityCut: 1,
      ...(weekday ? { maxDurationMin: BUSY_WEEKDAY_MAX_MIN } : {}),
      codes: ['WEEK_BUSY'],
      notes: ['Semana con muchas cosas: menos volumen, una sesión de calidad menos y sesiones cortas entre semana.'],
    };
  }
  if (load === 'free') return { codes: ['WEEK_FREE'], notes: ['Semana más libre: algo más de volumen, sin pasar del límite de progresión.'] };
  return null;
}

/** The restrictions of the imprevistos with the places and the Sunday answer merged in (unchanged without either). */
export function withWeekContext(restrictions: Record<ISODate, DayRestriction>, profile: ContextProfile): Record<ISODate, DayRestriction> {
  if (!profile.places && !profile.weekQuestions?.enabled) return restrictions;
  const out: Record<ISODate, DayRestriction> = {};
  for (const [date, r] of Object.entries(restrictions)) {
    const extra = [placeRestrictionOn(profile, date), weekLoadRestrictionOn(profile, date)].filter((x): x is Partial<DayRestriction> => x !== null);
    out[date] = extra.reduce<DayRestriction>((acc, x) => mergeRestrictions(acc, { ...NO_RESTRICTION, ...x }), r);
  }
  return out;
}

/** New sessions of a proposal fitted to the place of their day (rodillo / outside / strength without gym). */
export function adaptChangesToPlaces(changes: readonly PlanChange[], profile: ContextProfile): PlanChange[] {
  if (!profile.places) return [...changes];
  return changes.map((c) => (c.op === 'add' ? { ...c, workout: adaptDraftToPlace(c.workout, profile) } : c));
}

