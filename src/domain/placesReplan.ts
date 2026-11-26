/**
 * The planned sessions fitted to «Mis sitios» (pure, app only), e.g. after «Sí, vuelvo a
 * Castellón este finde»: a proposal the athlete reviews, never applied here.
 * - a bike or brick where there is no bike → moved to a day with a bike (re-planner rules),
 *   else half of it as an easy run (like «viaje sin bici»), else left out;
 * - a swim where there is no pool → moved, else 30' of strength with bands and core;
 * - a ride on the road where there is only the trainer → the same session on the rodillo;
 * - a rodillo session where there is only the road bike → the same session outside.
 * Quedadas are never changed: a sentence asks to agree it with the partner.
 */
import { TRAVEL } from './constants';
import { formatDayMedium } from './dates';
import { adaptDraftToPlace, bikeModeOn, placeOn } from './places';
import {
  allowedOn,
  downgrade,
  findMoveTarget,
  finish,
  isJoint,
  makeCtx,
  moveTo,
  note,
  partnerName,
  pending,
  record,
  remove,
  startPlan,
  type ReplanCtx,
  type ReplanInput,
  type ReplanResult,
  type WorkingPlan,
} from './replanCore';
import type { ISODate, Workout } from './types';

export interface PlacesReplanInput extends ReplanInput {
  /** Only these days (e.g. the weekend away); default: the whole editable window. */
  dates?: readonly ISODate[];
}

function noBike(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, place: string): WorkingPlan {
  const target = findMoveTarget(plan, ctx, w, { windowDays: 3, allowSwap: true });
  if (target) return moveTo(plan, ctx, w, target, `En ${place} no tienes bici: muevo «${w.title}» al ${formatDayMedium(target.date)}`);
  const runMin = Math.min(45, Math.round((w.durationMin * TRAVEL.noBikeRunShare) / 5) * 5);
  const sports = ctx.input.profile.sports as readonly string[];
  if (sports.includes('run') && allowedOn(ctx, { sport: 'run', intensity: 'endurance', durationMin: runMin }, w.date)) {
    return downgrade(plan, ctx, w, { sport: 'run', durationMin: runMin }, `En ${place} no tienes bici: la mitad del tiempo en carrera suave`);
  }
  return remove(plan, ctx, w, `En ${place} no tienes bici: esta sesión se queda fuera`);
}

function noPool(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, place: string): WorkingPlan {
  const target = findMoveTarget(plan, ctx, w, { windowDays: 3, allowSwap: true });
  if (target) return moveTo(plan, ctx, w, target, `En ${place} no tienes piscina: muevo «${w.title}» al ${formatDayMedium(target.date)}`);
  return downgrade(plan, ctx, w, { sport: 'strength', durationMin: TRAVEL.noPoolStrengthMin, intensity: 'endurance' }, `En ${place} no tienes piscina: 30 min de fuerza con gomas y core`);
}

function fitSession(plan: WorkingPlan, ctx: ReplanCtx, w: Workout): WorkingPlan {
  const profile = ctx.input.profile;
  const place = placeOn(profile, w.date);
  if (!place) return plan;
  const joint = isJoint(w);
  if (w.sport === 'bike' || w.sport === 'brick') {
    const mode = bikeModeOn(profile, w.date);
    if (mode === 'none') {
      return joint ? note(plan, `«${w.title}» es una quedada y en ${place.name} no tienes bici: háblalo con ${partnerName(w, ctx)}.`) : noBike(plan, ctx, w, place.name);
    }
    const adapted = adaptDraftToPlace({ date: w.date, sport: w.sport, title: w.title, description: w.description }, profile);
    if (adapted.title === w.title || joint) return plan;
    const reason = mode === 'indoor' ? `En ${place.name} solo tienes el rodillo: esta sesión, en rodillo.` : `En ${place.name} tienes la bici de carretera y no el rodillo: esta sesión, por fuera.`;
    return record(plan, { op: 'update', workoutId: w.id, patch: { title: adapted.title, description: adapted.description }, reason });
  }
  if (w.sport === 'swim' && !place.gear.pool) {
    return joint ? note(plan, `«${w.title}» es una quedada y en ${place.name} no tienes piscina: háblalo con ${partnerName(w, ctx)}.`) : noPool(plan, ctx, w, place.name);
  }
  return plan;
}

/** Proposal that fits the planned sessions to the place of their day (see the module comment). */
export function replanForPlaces(input: PlacesReplanInput): ReplanResult {
  if (!input.profile.places) return { changes: [], summary: '', failures: [] };
  const ctx = makeCtx(input);
  const inDates = (w: Workout) => !input.dates || input.dates.includes(w.date);
  let plan = startPlan(input);
  for (const w of pending(plan, ctx, inDates)) {
    if (plan.touched.has(w.id)) continue;
    plan = fitSession(plan, ctx, w);
  }
  return finish(plan, 'Tus sitios y su material.', 'Tus sesiones ya encajan con lo que tienes en cada sitio.');
}
