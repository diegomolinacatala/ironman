/**
 * Re-planning rules per type of life event (docs/research/02 §11.4-§11.9).
 * Each handler receives the working plan and returns a new one.
 */
import { CARDIAC_WARNING, INJURY, INJURY_DISCLAIMER, LIFE_STRESS, OTHER_SPORT_PROFILES, SUBSTITUTION_RATIO, TRAVEL } from './constants';
import { addDays, diffDays, formatDayMedium, timeToMinutes } from './dates';
import { lifeEventLoad, workoutLoad } from './load';
import { bodyAreaLabel, lifeEventLabel, sportLabel } from './labels';
import {
  allowedOn,
  dayHard,
  downgrade,
  findMoveTarget,
  hardPoints,
  isJoint,
  isKeyish,
  isLongWorkout,
  isLowPriority,
  isProtected,
  isQualityWorkout,
  moveTo,
  note,
  pending,
  pickStartTime,
  poolOk,
  record,
  restrictionOn,
  remove,
  shorten,
  withPartner,
  type ReplanCtx,
  type WorkingPlan,
} from './replanCore';
import { classifyIllness, eventEffects, INJURY_RULES, triageInjury, type DayRestriction } from './restrictions';
import type { ISODate, LifeEvent, Sport, Workout } from './types';

function eventDates(e: LifeEvent, ctx: ReplanCtx, extraAfter = 0): ISODate[] {
  const from = e.startDate > ctx.today ? e.startDate : ctx.today;
  const end = addDays(e.endDate, extraAfter);
  const to = end < ctx.weekEnd ? end : ctx.weekEnd;
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function effectsByDate(e: LifeEvent, ctx: ReplanCtx): Map<ISODate, Partial<DayRestriction>> {
  return new Map(eventEffects(e, ctx.weekEnd).map((x) => [x.date, x.r] as const));
}

function sportName(e: LifeEvent): string {
  if (e.kind === 'padel') return 'el pádel';
  if (e.kind === 'football') return 'el fútbol';
  return `«${e.title}»`;
}

function overlapsEvent(w: Workout, e: LifeEvent): boolean {
  if (!w.startTime || !e.startTime || w.date !== e.startDate) return false;
  const ws = timeToMinutes(w.startTime);
  const es = timeToMinutes(e.startTime);
  const ee = es + (e.durationMin ?? 60);
  return ws < ee && ws + w.durationMin > es;
}

/** First preferred sport the athlete does that is allowed on `date` (swim only on pool days). */
function easySportFor(ctx: ReplanCtx, date: ISODate, prefer: readonly Sport[]): Sport | null {
  const sports = ctx.input.profile.sports as readonly string[];
  const usable = (s: Sport) => sports.includes(s) && (s !== 'swim' || poolOk(ctx, date)) && allowedOn(ctx, { sport: s, intensity: 'endurance', durationMin: 30 }, date);
  return prefer.find(usable) ?? null;
}

// ---------------------------------------------------------------------------
// Other sports (pádel, fútbol…) §11.4
// ---------------------------------------------------------------------------

/** Hard session clashing with a fixed hard event: quedadas keep their slot but go easy; others move, else go easy (key) or drop. */
function resolveHardClash(plan: WorkingPlan, ctx: ReplanCtx, w: Workout, opts: { clash: boolean; avoid: readonly ISODate[]; moveReason: (to: ISODate) => string; easyReason: string; dropReason: string }): WorkingPlan {
  if (isJoint(w) && !opts.clash) return downgrade(plan, ctx, w, { durationMin: Math.min(w.durationMin, 60) }, opts.easyReason);
  const target = findMoveTarget(plan, ctx, w, { windowDays: isLongWorkout(w) || w.sport === 'brick' ? 2 : 3, avoid: opts.avoid, allowSwap: true });
  if (target) return moveTo(plan, ctx, w, target, opts.moveReason(target.date));
  if (isProtected(w)) return downgrade(plan, ctx, w, { durationMin: Math.min(w.durationMin, 60) }, opts.easyReason);
  return remove(plan, ctx, w, opts.dropReason);
}

function sameDayOtherSport(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  let p = plan;
  const sameDay = pending(p, ctx, (w) => w.date === e.startDate);
  const plannedDayLoad = sameDay.reduce((s, w) => s + workoutLoad(w), 0);
  const what = sportName(e);
  for (const w of sameDay) {
    const clash = overlapsEvent(w, e);
    if (isKeyish(w) || clash) {
      p = resolveHardClash(p, ctx, w, {
        clash,
        avoid: [],
        moveReason: (to) => `Ese día ya tienes ${what}: muevo «${w.title}» al ${formatDayMedium(to)} para no juntar dos esfuerzos duros`,
        easyReason: `Ese día ya tienes ${what}: la dejo suave para no juntar dos esfuerzos duros`,
        dropReason: `Ese día ya tienes ${what} y no hay otro hueco que respete el descanso: mejor no sumar otra sesión dura`,
      });
    } else if (isProtected(w)) {
      p = note(p, `Mantengo «${w.title}» del ${formatDayMedium(w.date)}: hazla muy suave si llegas cargado.`);
    } else if (lifeEventLoad(e) + workoutLoad(w) > 1.2 * plannedDayLoad) {
      p = remove(p, ctx, w, `Con ${what} ya cubres la carga de ese día`);
    }
  }
  return p;
}

function dayBeforeOtherSport(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  let p = plan;
  const prev = addDays(e.startDate, -1);
  for (const w of pending(p, ctx, (x) => x.date === prev && hardPoints(x) >= 1)) {
    p = resolveHardClash(p, ctx, w, {
      clash: false,
      avoid: [e.startDate, addDays(e.startDate, 1)],
      moveReason: (to) => `Al día siguiente tienes ${sportName(e)}: muevo «${w.title}» al ${formatDayMedium(to)} para no encadenar dos días duros`,
      easyReason: `Al día siguiente tienes ${sportName(e)}: mejor suave para no encadenar dos días duros`,
      dropReason: `Al día siguiente tienes ${sportName(e)} y no hay otro hueco: mejor no encadenar dos días duros`,
    });
  }
  return p;
}

function lockoutsOtherSport(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  let p = plan;
  const effects = effectsByDate(e, ctx);
  const nextDay = addDays(e.endDate, 1);
  const lockDates = [...new Set([nextDay, ...effects.keys()])].filter((d) => d > e.endDate);
  for (const date of lockDates) {
    for (const w of pending(p, ctx, (x) => x.date === date)) {
      const blocked = !allowedOn(ctx, w, date);
      const backToBack = date === nextDay && hardPoints(w) >= 1;
      if (!blocked && !backToBack) continue;
      const runBlocked = (effects.get(date)?.blockedSports ?? []).includes(w.sport);
      if (runBlocked) {
        const sub = easySportFor(ctx, date, ['bike', 'swim']);
        p = sub
          ? downgrade(p, ctx, w, { sport: sub, durationMin: Math.min(w.durationMin, 60) }, `Tras ${sportName(e)}, 24 h sin correr: cambio la carrera por ${sportLabel(sub).toLowerCase()} suave`)
          : remove(p, ctx, w, `Tras ${sportName(e)}, 24 h sin correr`);
        continue;
      }
      const target = isKeyish(w) && !isJoint(w) ? findMoveTarget(p, ctx, w, { windowDays: 3, avoid: lockDates, allowSwap: true }) : null;
      if (target) p = moveTo(p, ctx, w, target, `Tras ${sportName(e)} las piernas necesitan ${date === nextDay ? '24' : '48'} h: muevo «${w.title}» al ${formatDayMedium(target.date)}`);
      else p = downgrade(p, ctx, w, { durationMin: Math.min(w.durationMin, 45) }, `Tras ${sportName(e)}, mejor sin series ni sesiones largas: la dejo suave`);
    }
  }
  return p;
}

function weeklyLoadCap(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  const planned = ctx.input.weekWorkouts.filter((w) => w.status !== 'skipped').reduce((s, w) => s + workoutLoad(w), 0);
  if (planned <= 0) return plan;
  let p = plan;
  const projected = () => p.workouts.filter((w) => w.status !== 'skipped').reduce((s, w) => s + workoutLoad(w), 0) + lifeEventLoad(e);
  if (projected() <= 1.1 * planned) return p;
  const candidates = pending(p, ctx, isLowPriority).sort((a, b) => workoutLoad(b) - workoutLoad(a) || a.id.localeCompare(b.id));
  for (const w of candidates) {
    if (projected() <= 1.05 * planned) break;
    p = remove(p, ctx, w, `Con ${sportName(e)} la semana ya va cargada: quito esta sesión suave`);
  }
  return p;
}

function raceWarning(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  const race = (ctx.input.races ?? []).find((r) => r.priority === 'A' && diffDays(r.date, e.startDate) >= 0 && diffDays(r.date, e.startDate) <= 7);
  if (!race) return plan;
  return note(plan, `¿Seguro? Faltan ${diffDays(race.date, e.startDate)} días para ${race.name}: con ${sportName(e)} sube el riesgo de lesión.`);
}

export function replanOtherSport(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  const steps = [sameDayOtherSport, dayBeforeOtherSport, lockoutsOtherSport, weeklyLoadCap, raceWarning];
  const out = steps.reduce((p, step) => step(p, ctx, e), plan);
  const profile = OTHER_SPORT_PROFILES[e.kind === 'football' ? 'football' : e.kind === 'padel' ? 'padel' : 'other_sport'];
  const lock = profile.noRunHours > 0 ? `${profile.noRunHours} h sin correr y ${profile.noRunQualityHours} h sin series` : `${profile.noRunQualityHours} h sin series ni tirada larga`;
  return note(out, `${lifeEventLabel(e.kind)} cuenta como sesión dura: ${lock}.`);
}

// ---------------------------------------------------------------------------
// Injury §11.5
// ---------------------------------------------------------------------------

export function replanInjury(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  const triage = triageInjury(e);
  const area = e.bodyArea ?? 'other';
  const rule = INJURY_RULES[area];
  const areaText = bodyAreaLabel(area).toLowerCase();
  const effects = effectsByDate(e, ctx);
  const pro = 'si no mejora, consulta a un profesional';
  let p = plan;
  for (const w of pending(p, ctx, (x) => effects.has(x.date))) {
    const affected = rule.avoid.includes(w.sport) || (w.sport === 'brick' && rule.avoid.includes('run'));
    if (triage === 'red') {
      p = remove(p, ctx, w, `Con dolor fuerte en ${areaText} toca parar; consulta a un profesional antes de volver`);
    } else if (triage === 'amber' && affected) {
      const sub = rule.substitute && allowedOn(ctx, { sport: rule.substitute, intensity: 'endurance', durationMin: 30 }, w.date) ? rule.substitute : null;
      if (sub && (sub !== 'swim' || poolOk(ctx, w.date))) {
        const ratio = w.sport === 'run' || w.sport === 'brick' ? (SUBSTITUTION_RATIO[sub] ?? 1) : 1;
        const cap = sub === 'swim' ? 60 : 90;
        p = downgrade(p, ctx, w, { sport: sub, durationMin: Math.min(cap, w.durationMin * ratio), note: rule.note }, `Molestia en ${areaText}: cambio ${sportLabel(w.sport).toLowerCase()} por ${sportLabel(sub).toLowerCase()} suave; ${pro}`);
      } else {
        p = remove(p, ctx, w, `Molestia en ${areaText}: mejor descansar esta sesión; ${pro}`);
      }
    } else if (affected || rule.avoid.length === 0) {
      const factor = rule.avoid.length === 0 ? 0.8 : INJURY.greenVolumeFactor;
      p = isQualityWorkout(w) || isLongWorkout(w)
        ? downgrade(p, ctx, w, { sport: w.sport === 'brick' ? 'bike' : w.sport, durationMin: w.durationMin * factor }, `Molestia leve en ${areaText}: sesión más corta y sin intensidad; si va a más, consulta a un profesional`)
        : shorten(p, ctx, w, factor, `Molestia leve en ${areaText}: un 30 % menos de volumen; si va a más, consulta a un profesional`);
    }
  }
  return note(note(p, INJURY_DISCLAIMER), `Señales de alarma en ${areaText}: ${rule.alarm}.`);
}

// ---------------------------------------------------------------------------
// Illness §11.6 (neck check is triage, never a permission)
// ---------------------------------------------------------------------------

export function replanIllness(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  const cls = classifyIllness(e);
  const effects = effectsByDate(e, ctx);
  let p = plan;
  for (const w of pending(p, ctx, (x) => effects.has(x.date))) {
    const r = effects.get(w.date) ?? {};
    if (r.noTraining) {
      const reason = cls === 'cardiac'
        ? 'Con síntomas cardiacos no se entrena: consulta a un médico, idealmente un cardiólogo, antes de volver'
        : 'Con fiebre o síntomas por debajo del cuello toca descanso total hasta 24 h sin síntomas';
      p = remove(p, ctx, w, reason);
      continue;
    }
    const factor = r.volumeFactor ?? 1;
    const reason = cls === 'above_neck'
      ? 'Solo síntomas por encima del cuello y sin fiebre: sesión suave y corta, y si empeoras, para'
      : 'Vuelta progresiva tras la enfermedad: solo Z1-Z2 y menos volumen';
    p = downgrade(p, ctx, w, { sport: w.sport === 'brick' ? 'bike' : w.sport, durationMin: Math.max(20, w.durationMin * factor) }, reason);
  }
  if (cls === 'cardiac' || cls === 'flu') p = note(p, CARDIAC_WARNING);
  return note(p, 'Si los síntomas van a más o no mejoras en unos días, consulta a un profesional sanitario.');
}

// ---------------------------------------------------------------------------
// Stress, work peaks, exams, overload §11.7
// ---------------------------------------------------------------------------

function keepFirst(list: readonly Workout[], keep: number): Workout[] {
  const sorted = [...list].sort((a, b) => Number(isProtected(b)) - Number(isProtected(a)) || b.durationMin - a.durationMin || a.id.localeCompare(b.id));
  return sorted.slice(keep);
}

/**
 * Quality sessions to turn easy: overload (no body area) forbids quality on
 * its days, like the planner's OVERLOAD restriction; stress drops one; work
 * peaks and exams keep 1 quality + 1 long (ST2).
 */
function stressDowngrades(ctx: ReplanCtx, e: LifeEvent, sessions: readonly Workout[]): Workout[] {
  const qualities = sessions.filter(isQualityWorkout);
  if (e.kind === 'overload') return qualities.filter((w) => restrictionOn(ctx, w.date).noQuality);
  if (e.kind === 'stress') return keepFirst(qualities, Math.max(0, qualities.length - 1));
  return [...keepFirst(qualities, 1), ...keepFirst(sessions.filter(isLongWorkout), 1)];
}

export function replanStress(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  const dates = eventDates(e, ctx);
  const isStress = e.kind === 'stress' || e.kind === 'overload';
  const factor = isStress ? (e.severity >= 3 ? 0.7 : LIFE_STRESS.stressVolumeFactor) : (LIFE_STRESS.workVolumeFactor[Math.min(Math.max(e.severity, 1), 3) - 1] ?? 0.7);
  const label = e.kind === 'exam' ? 'Semana de exámenes' : e.kind === 'work' ? 'Pico de trabajo' : e.kind === 'overload' ? 'Sobrecarga' : 'Estrés alto';
  let p = plan;
  const sessions = pending(p, ctx, (w) => dates.includes(w.date));
  const downgradeList = stressDowngrades(ctx, e, sessions);
  const easyReason = e.kind === 'overload' ? `${label}: unos días sin calidad, así que esta sesión pasa a suave` : `${label}: dejamos solo lo esencial y esta sesión pasa a suave`;
  for (const w of downgradeList) {
    // Quedadas stay as agreed; extra key sessions give way (only 1 quality + 1 long survive, ST2).
    if (isJoint(w)) continue;
    p = downgrade(p, ctx, w, { sport: w.sport === 'brick' ? 'bike' : w.sport, durationMin: Math.min(w.durationMin * factor, 60) }, easyReason);
  }
  for (const w of pending(p, ctx, (x) => dates.includes(x.date))) {
    if (isProtected(w)) continue;
    p = shorten(p, ctx, w, factor, `${label}: recorto el volumen un ${Math.round((1 - factor) * 100)} % para que llegues a todo`);
  }
  return note(p, `${label}: la prioridad es descansar bien; mantenemos lo esencial y la progresión se frena unos días.`);
}

// ---------------------------------------------------------------------------
// Travel §11.9
// ---------------------------------------------------------------------------

export function replanTravel(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  const effects = effectsByDate(e, ctx);
  const allDates = [...effects.keys()];
  let p = plan;
  for (const w of pending(p, ctx, (x) => effects.has(x.date))) {
    const r = effects.get(w.date) ?? {};
    const travelDay = r.maxDurationMin !== undefined && r.maxDurationMin !== null;
    const blocked = (r.blockedSports ?? []).includes(w.sport);
    if (travelDay && isKeyish(w) && !isProtected(w)) {
      const target = findMoveTarget(p, ctx, w, { windowDays: 3, avoid: allDates, allowSwap: true });
      if (target) {
        p = moveTo(p, ctx, w, target, `Día de viaje: muevo «${w.title}» al ${formatDayMedium(target.date)}`);
        continue;
      }
    }
    if (blocked && (w.sport === 'bike' || w.sport === 'brick')) {
      const run = easySportFor(ctx, w.date, ['run']);
      p = run
        ? downgrade(p, ctx, w, { sport: 'run', durationMin: Math.min(45, w.durationMin * TRAVEL.noBikeRunShare) }, 'Sin bici en el viaje: la mitad del tiempo en carrera suave, la carga de bici no se pasa entera a correr')
        : remove(p, ctx, w, 'Sin bici en el viaje: esta sesión se queda fuera');
    } else if (blocked && w.sport === 'swim') {
      p = downgrade(p, ctx, w, { sport: 'strength', durationMin: TRAVEL.noPoolStrengthMin, intensity: 'endurance' }, 'Sin piscina en el viaje: 30 min de fuerza con gomas y core');
    } else if (travelDay) {
      p = downgrade(p, ctx, w, { durationMin: Math.min(TRAVEL.travelDayMaxMin, w.durationMin) }, 'Día de viaje: como mucho 45 min suaves para soltar piernas');
    }
  }
  return note(p, 'Si cambias de huso horario (3 o más horas), los primeros días mejor sin series y con luz natural.');
}

// ---------------------------------------------------------------------------
// Social plans and time conflicts
// ---------------------------------------------------------------------------

export function replanSocial(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  if (e.severity < 2) return plan;
  const next = addDays(e.endDate, 1);
  let p = plan;
  for (const w of pending(p, ctx, (x) => x.date === next && isQualityWorkout(x) && !isProtected(x))) {
    const target = findMoveTarget(p, ctx, w, { windowDays: 3, allowSwap: true });
    if (target) p = moveTo(p, ctx, w, target, `Tras ${e.title.toLowerCase()} mejor no hacer calidad al día siguiente: muevo «${w.title}»`);
    else p = downgrade(p, ctx, w, { durationMin: Math.min(w.durationMin, 50) }, `Tras ${e.title.toLowerCase()} mejor sin calidad al día siguiente: la dejo suave`);
  }
  return p;
}

/** Workouts whose time overlaps the event: new time that day, another day, or a note. */
export function resolveTimeConflicts(plan: WorkingPlan, ctx: ReplanCtx, e: LifeEvent): WorkingPlan {
  if (!e.startTime || !e.durationMin) return plan;
  let p = plan;
  for (const w of pending(p, ctx, (x) => overlapsEvent(x, e))) {
    const sameDay = pickStartTime(p, ctx, { ...w, startTime: null }, w.date, w.durationMin);
    if (sameDay.ok && sameDay.time) {
      p = record(p, { op: 'move', workoutId: w.id, toDate: w.date, toStartTime: sameDay.time, reason: withPartner(w, ctx, `Coincide con «${e.title}»: lo paso a las ${sameDay.time}`) });
      continue;
    }
    const target = findMoveTarget(p, ctx, w, { windowDays: 3, allowSwap: !isProtected(w) });
    if (target) p = moveTo(p, ctx, w, target, `Coincide con «${e.title}»: lo muevo al ${formatDayMedium(target.date)}`);
    else p = note(p, `«${w.title}» coincide con «${e.title}» y no veo otro hueco: cámbialo de hora si puedes.`);
  }
  return p;
}

/** Hard days of the remaining week (for tests and summaries). */
export function remainingHardDays(plan: WorkingPlan, ctx: ReplanCtx): ISODate[] {
  const out: ISODate[] = [];
  for (let d = ctx.today; d <= ctx.weekEnd; d = addDays(d, 1)) if (dayHard(plan, ctx, d) >= 1) out.push(d);
  return out;
}
