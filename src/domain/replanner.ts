/**
 * Re-planner (docs/research/02 §11): reacts to a life event, the morning
 * readiness or missed sessions with a list of PlanChange, each with a Spanish
 * one-sentence reason. Never touches completed workouts; quedadas and key
 * sessions are protected (changed only when unavoidable, naming the partner).
 */
import { READINESS_EFFECTS, MISSED } from './constants';
import { diffDays, formatDayMedium } from './dates';
import { lifeEventLabel, readinessLabel } from './labels';
import { phaseFor } from './periodization';
import type { Readiness } from './readiness';
import {
  allowedOn,
  downgrade,
  findMoveTarget,
  finish,
  isJoint,
  isKeyish,
  isLongWorkout,
  isProtected,
  isQualityWorkout,
  makeCtx,
  moveTo,
  note,
  pending,
  poolOk,
  record,
  shorten,
  startPlan,
  withPartner,
  type ReplanCtx,
  type ReplanInput,
  type ReplanResult,
  type WorkingPlan,
} from './replanCore';
import { replanIllness, replanInjury, replanOtherSport, replanSocial, replanStress, replanTravel, resolveTimeConflicts } from './replanEvents';
import { estimateTss } from './load';
import type { LifeEvent, Sport, Workout } from './types';

export type { ReplanInput, ReplanResult } from './replanCore';
/** Editable window today..today+6 (callers load workouts/busy blocks/quedadas for it). */
export { REPLAN_WINDOW_DAYS, replanWindowEnd } from './replanCore';

function applyEvent(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  switch (e.kind) {
    case 'padel':
    case 'football':
    case 'other_sport':
      return replanOtherSport(plan, ctx, e);
    case 'injury':
      return replanInjury(plan, ctx, e);
    case 'illness':
      return replanIllness(plan, ctx, e);
    case 'overload':
      return e.bodyArea ? replanInjury(plan, ctx, { ...e, severity: e.severity >= 2 ? 2 : 1 }) : replanStress(plan, ctx, e);
    case 'stress':
    case 'work':
    case 'exam':
      return replanStress(plan, ctx, e);
    case 'travel':
      return replanTravel(plan, ctx, e);
    case 'social':
      return replanSocial(plan, ctx, e);
    default:
      return plan;
  }
}

/** Re-plan the rest of the week after an "imprevisto". */
export function replanForEvent(input: ReplanInput & { event: LifeEvent }): ReplanResult {
  const e = input.event;
  const ctx = makeCtx(input, [e]);
  const handled = applyEvent(startPlan(input), ctx, e);
  const plan = e.kind === 'injury' || e.kind === 'illness' ? handled : resolveTimeConflicts(handled, ctx, e);
  const when = e.endDate > e.startDate ? `${formatDayMedium(e.startDate)} – ${formatDayMedium(e.endDate)}` : formatDayMedium(e.startDate);
  return finish(plan, `${lifeEventLabel(e.kind)}: ${e.title} (${when}).`, 'Tu semana ya encaja con este imprevisto: no hace falta cambiar nada.');
}

// ---------------------------------------------------------------------------
// Readiness §11.8
// ---------------------------------------------------------------------------

/** Low-impact substitute for a run/brick on a red day: bike, else swim on a pool day, else the same sport. */
function easiestSport(ctx: ReplanCtx, w: Workout): Sport {
  if (w.sport !== 'run' && w.sport !== 'brick') return w.sport;
  const options: Sport[] = ['bike', 'swim'];
  const sports = ctx.input.profile.sports as readonly string[];
  const usable = (s: Sport) => sports.includes(s) && (s !== 'swim' || poolOk(ctx, w.date)) && allowedOn(ctx, { sport: s, intensity: 'recovery', durationMin: 30 }, w.date);
  return options.find(usable) ?? (w.sport === 'brick' ? 'bike' : 'run');
}

function redDay(plan: WorkingPlan, ctx: ReplanCtx): WorkingPlan {
  let p = plan;
  const maxMin = READINESS_EFFECTS.redMaxEasyMin;
  for (const w of pending(p, ctx, (x) => x.date === ctx.today)) {
    if (isKeyish(w) && !isJoint(w)) {
      const target = findMoveTarget(p, ctx, w, { windowDays: isLongWorkout(w) ? MISSED.moveWindowLongDays : MISSED.moveWindowQualityDays, allowSwap: true });
      if (target) {
        p = moveTo(p, ctx, w, target, `Tu cuerpo pide recuperar: muevo «${w.title}» al ${formatDayMedium(target.date)}`);
        continue;
      }
    }
    const sport = isJoint(w) ? (w.sport === 'brick' ? 'bike' : w.sport) : easiestSport(ctx, w);
    p = downgrade(p, ctx, w, { sport, intensity: 'recovery', durationMin: Math.min(maxMin, w.durationMin) }, 'Señales de fatiga altas: hoy solo algo muy suave, como mucho 45 min en Z1');
  }
  return p;
}

function amberDay(plan: WorkingPlan, ctx: ReplanCtx): WorkingPlan {
  let p = plan;
  for (const w of pending(p, ctx, (x) => x.date === ctx.today)) {
    if (isQualityWorkout(w)) {
      // Key sessions are better moved than cut; quedadas keep their slot.
      const target = isJoint(w) ? null : findMoveTarget(p, ctx, w, { windowDays: 2, allowSwap: true, preferSwap: true });
      if (target?.swap) {
        const easy = target.swap;
        p = record(p, { op: 'move', workoutId: w.id, toDate: target.date, toStartTime: target.time, reason: `Hoy vas algo justo: cambio «${w.title}» por la sesión suave del ${formatDayMedium(target.date)}.` });
        p = record(p, { op: 'move', workoutId: easy.id, toDate: ctx.today, toStartTime: w.startTime, reason: withPartner(easy, ctx, 'Hoy toca lo suave y la calidad pasa a otro día') });
      } else if (target) {
        p = moveTo(p, ctx, w, target, `Hoy vas algo justo: paso «${w.title}» al ${formatDayMedium(target.date)}`);
      } else {
        const durationMin = Math.max(20, Math.round((w.durationMin * READINESS_EFFECTS.amberQualityCut) / 5) * 5);
        p = record(p, { op: 'update', workoutId: w.id, patch: { durationMin, tss: estimateTss({ ...w, durationMin }) }, reason: withPartner(w, ctx, 'Hoy vas algo justo: recorta las series un 30 % y no fuerces') });
      }
    } else if (isLongWorkout(w)) {
      p = downgrade(p, ctx, w, { sport: w.sport === 'brick' ? 'bike' : w.sport, durationMin: w.durationMin * READINESS_EFFECTS.amberLongCut }, 'Hoy vas algo justo: tirada un 20 % más corta y solo en Z1-Z2');
    }
  }
  return p;
}

/** Adjust today's sessions to the morning readiness traffic light. */
export function replanForReadiness(input: ReplanInput & { readiness: Readiness }): ReplanResult {
  const r = input.readiness;
  const ctx = makeCtx(input);
  let plan = startPlan(input);
  if (r.level === 'red') plan = redDay(plan, ctx);
  else if (r.level === 'amber') plan = amberDay(plan, ctx);
  else if (r.level === 'green' && r.factors.length > 0) plan = note(plan, 'Hay alguna señal leve: si te notas cansado, cambia la sesión dura por una suave.');
  const score = r.score !== null ? ` (${r.score}/100)` : '';
  const factors = r.factors.length > 0 ? ` ${r.factors.slice(0, 3).join(', ')}.` : '';
  const nothing = r.level === 'unknown' ? r.recommendation : 'Puedes seguir el plan de hoy tal cual.';
  return finish(plan, `Hoy: ${readinessLabel(r.level).toLowerCase()}${score}.${factors}`, nothing);
}

// ---------------------------------------------------------------------------
// Missed sessions §11.2
// ---------------------------------------------------------------------------

function longAbsence(plan: WorkingPlan, ctx: ReplanCtx, gapDays: number): WorkingPlan {
  let p = plan;
  const sessions = pending(p, ctx);
  const factor = gapDays >= 7 ? 0.75 : 0.8;
  const qualities = sessions.filter(isQualityWorkout);
  const keepQuality = gapDays >= 7 ? 0 : 1;
  const first = sessions[0];
  if (first && isKeyish(first) && !isProtected(first)) {
    p = downgrade(p, ctx, first, { sport: first.sport === 'brick' ? 'bike' : first.sport, durationMin: Math.min(first.durationMin, 45) }, 'Primer día de vuelta tras varios días sin entrenar: empieza suave');
  }
  for (const w of qualities.slice(keepQuality)) {
    if (isProtected(w)) continue;
    p = downgrade(p, ctx, w, { sport: w.sport === 'brick' ? 'bike' : w.sport, durationMin: w.durationMin * factor }, 'Volvemos poco a poco: como mucho una sesión de calidad esta semana');
  }
  for (const w of pending(p, ctx)) {
    if (!isProtected(w)) p = shorten(p, ctx, w, factor, `Volvemos poco a poco: esta semana al ${Math.round(factor * 100)} % del volumen`);
  }
  return note(p, 'No recuperamos lo perdido: volver de golpe es la forma más fácil de lesionarse.');
}

function placeMissed(plan: WorkingPlan, ctx: ReplanCtx, w: Workout): WorkingPlan {
  const windowDays = isLongWorkout(w) || w.sport === 'brick' ? MISSED.moveWindowLongDays : MISSED.moveWindowQualityDays;
  const target = findMoveTarget(plan, ctx, w, { windowDays, allowSwap: true });
  if (target) return moveTo(plan, ctx, w, target, `No pasa nada por saltarte «${w.title}»: la muevo al ${formatDayMedium(target.date)} en lugar de sumarla a otro día`);
  const durationMin = Math.max(20, Math.round((w.durationMin * MISSED.shrinkFactor) / 5) * 5);
  const short = { ...w, durationMin };
  const shortTarget = findMoveTarget(plan, ctx, short, { windowDays, allowSwap: false });
  if (shortTarget) {
    return record(plan, {
      op: 'update',
      workoutId: w.id,
      patch: { date: shortTarget.date, startTime: shortTarget.time, durationMin, tss: estimateTss({ ...w, durationMin }) },
      reason: withPartner(w, ctx, `«${w.title}» no cabe entera: la recuperamos en versión corta el ${formatDayMedium(shortTarget.date)}`),
    });
  }
  const extra = isLongWorkout(w) ? ' Si la larga vuelve a caerse la semana que viene, lo revisamos.' : '';
  return note(plan, `No he encontrado hueco para «${w.title}» sin forzar: mejor dejarla y seguir con el plan.${extra}`);
}

/** Missed sessions: no cramming; key ones move ±2-3 days or shrink, easy ones are not recovered. */
export function replanMissed(input: ReplanInput & { missed: Workout[] }): ReplanResult {
  const ctx = makeCtx(input);
  let plan = startPlan(input);
  const missed = input.missed
    .filter((w) => w.status === 'planned' && w.date < ctx.today && w.sport !== 'rest')
    .sort((a, b) => Number(isKeyish(b)) - Number(isKeyish(a)) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const phase = phaseFor(ctx.today, input.races ?? [], { level: input.profile.level });
  const dates = [...new Set(missed.map((w) => w.date))].sort();
  const firstMissed = dates[0];
  const doneSince = firstMissed ? input.weekWorkouts.some((w) => w.status === 'completed' && w.date >= firstMissed && w.date < ctx.today) : true;
  const gap = firstMissed && !doneSince ? diffDays(ctx.today, firstMissed) : 0;
  if (gap >= 3) {
    plan = longAbsence(plan, ctx, gap);
  } else if (phase.phase === 'race_week' || phase.isRecoveryWeek) {
    plan = note(plan, phase.phase === 'race_week' ? 'Semana de carrera: lo perdido no se recupera, llega fresco.' : 'Semana de descarga: no hace falta recuperar nada.');
  } else {
    for (const w of missed) {
      if (isJoint(w)) plan = note(plan, `La quedada «${w.title}» ya pasó: si queréis repetirla, proponed otra desde Juntos.`);
      else if (!isKeyish(w) && !w.isKey) plan = note(plan, `No hace falta recuperar «${w.title}»: las sesiones suaves no se recuperan.`);
      else plan = placeMissed(plan, ctx, w);
    }
  }
  const headline = missed.length === 1 ? 'Te saltaste 1 sesión.' : `Te saltaste ${missed.length} sesiones.`;
  return finish(plan, headline, 'No muevo nada: seguimos con el plan.');
}
