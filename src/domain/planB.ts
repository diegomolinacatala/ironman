/**
 * "No es mi día": the easier version of a planned session, one tap away on the
 * workout, Hoy and the check-in. Same rules as the re-planner's easy downgrade
 * (`replanCore.easyPatch`) and the plan B sentence of every prescription
 * (`sessionEasier.ts`): about 65 % of the time, Z2 for quality and long
 * sessions, Z1 for easy ones (strength → mobility), steps, targets and coaching
 * rebuilt for the athlete. Pure.
 */
import { easyPatch } from './replanCore';
import { intensityRank } from './restrictions';
import { easierVersion, type EasierOptions } from './sessionEasier';
import { lowerStart } from './sessionKit';
import type { Thresholds, Workout, WorkoutPatch } from './types';

const TITLE_MAX = 120;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The race itself and key race-pace sessions keep their plan: no one-tap version. */
function isRaceSession(w: Workout): boolean {
  return w.intensity === 'race' && (w.isKey || w.sport === 'other');
}

/** Already as easy and short as its easier version would be. */
function isAlreadyEasy(w: Workout, easier: { intensity: 'endurance' | 'recovery'; durationMin: number }): boolean {
  return intensityRank(w.intensity) <= intensityRank(easier.intensity) && w.durationMin <= easier.durationMin;
}

/**
 * Patch that turns a planned session into its easier version ("Versión suave:
 * rodaje suave Z2", 35' in Z2 with targets and coaching), or null when there is
 * none: rest days, completed or skipped sessions, the race and key race-pace
 * sessions, sessions that are already that easy. `opts.recovery` forces the Z1
 * version and `opts.maxMin` caps it (red readiness: 45').
 */
export function notMyDayPatch(workout: Workout, thresholds?: Thresholds | null, opts: EasierOptions = {}): WorkoutPatch | null {
  if (workout.status !== 'planned' || workout.sport === 'rest' || isRaceSession(workout)) return null;
  const easier = easierVersion(workout, opts);
  if (!easier || isAlreadyEasy(workout, easier)) return null;
  const patch = easyPatch(workout, { sport: easier.sport, intensity: easier.intensity, durationMin: easier.durationMin }, { thresholds: thresholds ?? null });
  const easyTitle = patch.title ?? workout.title;
  const description = patch.description ? `En lugar de «${workout.title}»: ${patch.description}` : `En lugar de «${workout.title}».`;
  return {
    ...patch,
    title: clip(`Versión suave: ${lowerStart(easyTitle)}`, TITLE_MAX),
    description,
    isKey: false,
  };
}
