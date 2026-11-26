/**
 * Situations the athlete tells the rules coach (no AI) in the chat, turned
 * into a proposal with the domain re-planner, so the most common requests get
 * exact changes without depending on the AI:
 * - told: "mañana tengo una cena", "esta semana tengo exámenes", "estoy de
 *   viaje del jueves al domingo (con bici)", "tengo un pico de trabajo",
 *   "no tengo piscina esta semana", "solo tengo 30 minutos hoy";
 * - asked: "hazme la semana más suave", "quiero más bici / menos carrera",
 *   "estoy muy cansado", "he dormido fatal".
 * Imprevistos (exams, trips, work, stress, plans) come back in `logEvent`, so
 * the coach logs them and they count in the plan from then on. Pure.
 */
import { addDays, diffDays, formatDayMedium, startOfWeek } from '@/domain/dates';
import { estimateTss } from '@/domain/load';
import type { Readiness } from '@/domain/readiness';
import { easyPatch, isLongWorkout, isLowPriority, isQualityWorkout, shortenedPatch } from '@/domain/replanCore';
import { replanForEvent, replanForReadiness } from '@/domain/replanner';
import type { ISODate, ISOTime, LifeEvent, LifeEventDraft, LifeEventKind, PlanChange, Severity, Sport, Workout, WorkoutDraft } from '@/domain/types';

import { capitalized, dayLabel, dayRefs, editable, quoted, rangeIn, timeIn, WINDOW_DAYS, type DateRange, type EditContext, type EditResult } from './coachWords';

export type SituationGroup = 'told' | 'asked';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function asEvent(draft: LifeEventDraft, ctx: EditContext): LifeEvent {
  return {
    id: 'chat-event',
    userId: ctx.replanInput.profile.id,
    kind: draft.kind,
    title: draft.title,
    startDate: draft.startDate,
    endDate: draft.endDate ?? draft.startDate,
    startTime: draft.startTime ?? null,
    durationMin: draft.durationMin ?? null,
    severity: draft.severity,
    bodyArea: null,
    notes: draft.notes ?? null,
    createdAt: `${ctx.today}T00:00:00.000Z`,
  };
}

function replanWith(draft: LifeEventDraft, ctx: EditContext): { changes: PlanChange[]; summary: string } {
  return replanForEvent({ ...ctx.replanInput, today: ctx.today, weekWorkouts: [...ctx.workouts], event: asEvent(draft, ctx) });
}

/** Today..today+6 (the editable window). */
function windowRange(ctx: EditContext): DateRange {
  return { from: ctx.today, to: addDays(ctx.today, WINDOW_DAYS - 1) };
}

/** From today on: an imprevisto never starts in the past. */
function fromToday(range: DateRange, today: ISODate): DateRange {
  return { from: range.from < today ? today : range.from, to: range.to < today ? today : range.to };
}

function rangeWords(range: DateRange, today: ISODate): string {
  if (range.from === range.to) return dayLabel(range.from, today);
  return `del ${formatDayMedium(range.from)} al ${formatDayMedium(range.to)}`;
}

function inRange(w: Workout, range: DateRange): boolean {
  return w.date >= range.from && w.date <= range.to;
}

function round5(minutes: number): number {
  return Math.max(15, Math.round(minutes / 5) * 5);
}

/** "estoy", "tengo", "me voy"…: the athlete tells something, rather than asking about it. */
const TELLS_RE = /\b(?:tengo|tendre|estoy|estare|empiezo|empiezan|empieza|voy a tener|hay|me voy|nos vamos|salgo|vuelvo|me toca|me tocan)\b/;

// ---------------------------------------------------------------------------
// Told: a plan in the evening (cena, comida, boda…)
// ---------------------------------------------------------------------------

interface PlanKind {
  /** With its article, for the reply ("la cena"). */
  name: string;
  title: string;
  time: ISOTime;
  durationMin: number;
}

const PLANS: Readonly<Record<string, PlanKind>> = {
  cena: { name: 'la cena', title: 'Cena', time: '21:00', durationMin: 150 },
  comida: { name: 'la comida', title: 'Comida', time: '14:00', durationMin: 150 },
  boda: { name: 'la boda', title: 'Boda', time: '12:00', durationMin: 720 },
  cumple: { name: 'el cumpleaños', title: 'Cumpleaños', time: '20:00', durationMin: 180 },
  cumpleanos: { name: 'el cumpleaños', title: 'Cumpleaños', time: '20:00', durationMin: 180 },
  fiesta: { name: 'la fiesta', title: 'Fiesta', time: '22:00', durationMin: 240 },
  evento: { name: 'el evento', title: 'Evento', time: '19:00', durationMin: 120 },
  reunion: { name: 'la reunión', title: 'Reunión', time: '18:00', durationMin: 90 },
  concierto: { name: 'el concierto', title: 'Concierto', time: '21:00', durationMin: 180 },
  cine: { name: 'el cine', title: 'Cine', time: '20:00', durationMin: 150 },
  teatro: { name: 'el teatro', title: 'Teatro', time: '20:00', durationMin: 150 },
  despedida: { name: 'la despedida', title: 'Despedida', time: '21:00', durationMin: 300 },
  celebracion: { name: 'la celebración', title: 'Celebración', time: '20:00', durationMin: 180 },
  cita: { name: 'la cita', title: 'Cita', time: '20:00', durationMin: 120 },
};

const PLAN_RE = /\b(?:tengo|hay|me han invitado a|voy a ir a|voy a una?|voy al|me voy de|nos vamos de)\b[^.?!]*?\b(cena|comida|boda|cumpleanos|cumple|fiesta|evento|reunion|concierto|cine|teatro|despedida|celebracion|cita)\b/;

function eveningPlan(text: string, ctx: EditContext): EditResult | null {
  const word = PLAN_RE.exec(text)?.[1];
  const plan = word ? PLANS[word] : undefined;
  const date = dayRefs(text, ctx.today)[0]?.date;
  if (!plan || !date) return null;
  const startTime = timeIn(text) ?? plan.time;
  const logEvent: LifeEventDraft = { kind: 'social', title: plan.title, startDate: date, endDate: date, startTime, durationMin: plan.durationMin, severity: 1 };
  const result = replanWith(logEvent, ctx);
  if (result.changes.length > 0) return { ...result, logEvent };
  const day = dayLabel(date, ctx.today);
  const sessions = editable(ctx).filter((w) => w.date === date);
  const summary =
    sessions.length === 0
      ? `${capitalized(day)} no tienes entreno: disfruta de ${plan.name}.`
      : `${sessions.map(quoted).join(' y ')} no choca con ${plan.name}: no hace falta cambiar nada. Disfruta.`;
  // Nothing to move: no need to log a dinner as an imprevisto.
  return { changes: [], summary };
}

// ---------------------------------------------------------------------------
// Told: exams, study, a trip, work, stress
// ---------------------------------------------------------------------------

const EXAM_RE = /\bexamen(?:es)?\b|\bselectividad\b|\bevau\b|\bfinales\b|\bparciales\b|\boposicion(?:es)?\b/;
const BIG_EXAMS_RE = /\bselectividad\b|\bevau\b|\boposicion|\bfinales\b|\bmuchos examenes\b/;
const STUDY_RE = /\bsemana de estudio\b|\b(?:epoca|dias|semanas) de estudio\b|\bestoy estudiando\b|\btengo que estudiar\b|\bestudiando mucho\b|\bme toca estudiar\b/;

function studyRange(text: string, ctx: EditContext, single: boolean): DateRange {
  const range = rangeIn(text, ctx.today);
  if (!range) return { from: ctx.today, to: addDays(startOfWeek(ctx.today), 6) > ctx.today ? addDays(startOfWeek(ctx.today), 6) : addDays(ctx.today, WINDOW_DAYS - 1) };
  // A single exam: the day before counts too (sleep and nerves), never before today.
  if (single && range.from === range.to) return fromToday({ from: addDays(range.from, -1), to: range.to }, ctx.today);
  return fromToday(range, ctx.today);
}

function examsOrStudy(text: string, ctx: EditContext): EditResult | null {
  const exam = EXAM_RE.test(text);
  const study = STUDY_RE.test(text);
  if ((!exam && !study) || (!TELLS_RE.test(text) && !study)) return null;
  const range = studyRange(text, ctx, exam && /\bexamen\b/.test(text));
  const severity: Severity = BIG_EXAMS_RE.test(text) ? 3 : exam ? 2 : 1;
  const title = exam ? (range.from === range.to || /\bexamen\b/.test(text) ? 'Examen' : 'Exámenes') : 'Semana de estudio';
  const logEvent: LifeEventDraft = { kind: 'exam', title, startDate: range.from, endDate: range.to, severity, notes: null };
  const result = replanWith(logEvent, ctx);
  if (result.changes.length > 0) return { ...result, logEvent };
  return { changes: [], summary: `Apunto ${title === 'Semana de estudio' ? 'el estudio' : 'los exámenes'} ${rangeWords(range, ctx.today)}. No tienes entrenos esos días que cambiar: mucho ánimo.`, logEvent };
}

const TRAVEL_RE = /\bde viaje\b|\bviaj(?:o|are|amos|aremos)\b|\bme voy (?:a|de) (?!correr|entrenar|nadar)|\bestoy fuera\b|\bestare fuera\b|\bfuera de casa\b|\bde vacaciones\b/;
const WITH_BIKE_RE = /\bcon (?:la |mi )?bici\b|\bllevo (?:la |mi )?bici\b|\bcon (?:el )?rodillo\b|\bhay bici\b|\balquilo (?:una )?bici\b/;
const WITH_POOL_RE = /\bcon piscina\b|\bhay piscina\b|\bpuedo nadar\b|\btiene piscina\b/;

function trip(text: string, ctx: EditContext): EditResult | null {
  if (!TRAVEL_RE.test(text) || !TELLS_RE.test(text)) return null;
  const range = rangeIn(text, ctx.today);
  if (!range) return { changes: [], summary: '¿Qué días estás fuera? Dímelo así: «estoy de viaje del jueves al domingo» (y si llevas bici o hay piscina) y te reorganizo esos días.' };
  const span = fromToday(range, ctx.today);
  // The re-planner reads "bici" / "piscina" in the notes as "available there".
  const notes = [WITH_BIKE_RE.test(text) ? 'Con bici.' : null, WITH_POOL_RE.test(text) ? 'Con piscina.' : null].filter(Boolean).join(' ') || null;
  const logEvent: LifeEventDraft = { kind: 'travel', title: 'Viaje', startDate: span.from, endDate: span.to, severity: 1, notes };
  const result = replanWith(logEvent, ctx);
  if (result.changes.length > 0) return { ...result, logEvent };
  return { changes: [], summary: `Apunto el viaje ${rangeWords(span, ctx.today)}. Tu plan de esos días ya encaja: buen viaje.`, logEvent };
}

const WORK_RE = /\bpico de trabajo\b|\bmucho (?:trabajo|curro)\b|\bsemana (?:muy )?(?:dura|complicada|liada|horrible|de locos) (?:de|en el) (?:trabajo|curro)\b|\bvoy (?:a tope|hasta arriba) (?:de|en el) (?:trabajo|curro)\b|\bentregas? (?:de|en el) trabajo\b|\bcierre (?:de mes|trimestral|de ano)\b|\bguardias?\b/;
const STRESS_RE = /\b(?:estoy|ando|voy|me siento)\b[^.?!]*\b(?:estresad|agobiad|desbordad)/;

function workOrStress(text: string, ctx: EditContext): EditResult | null {
  const work = WORK_RE.test(text);
  const stress = !work && STRESS_RE.test(text);
  if (!work && !stress) return null;
  const range = fromToday(rangeIn(text, ctx.today) ?? windowRange(ctx), ctx.today);
  const kind: LifeEventKind = work ? 'work' : 'stress';
  const title = work ? 'Pico de trabajo' : 'Estrés';
  const logEvent: LifeEventDraft = { kind, title, startDate: range.from, endDate: range.to, severity: 2, notes: null };
  const result = replanWith(logEvent, ctx);
  if (result.changes.length > 0) return { ...result, logEvent };
  return { changes: [], summary: `Lo apunto ${rangeWords(range, ctx.today)}. Tu plan de esos días ya es ligero: prioriza dormir bien.`, logEvent };
}

// ---------------------------------------------------------------------------
// Told: no pool
// ---------------------------------------------------------------------------

const NO_POOL_RE = /\bno (?:tengo|hay|tendre|tendremos|voy a tener|puedo ir a la|puedo usar la)\b[^.?!]*\bpiscina\b|\bpiscina (?:esta )?cerrada\b|\bcierran la piscina\b|\bsin piscina\b|\bno puedo nadar\b/;
const DRY_SWIM_MIN = 30;

function drySwimPatch(): Partial<WorkoutDraft> {
  return {
    sport: 'strength',
    intensity: 'endurance',
    durationMin: DRY_SWIM_MIN,
    distanceM: null,
    title: 'Fuerza en seco para nadar',
    description: `${DRY_SWIM_MIN}': movilidad de hombro, tracción con gomas imitando la brazada, remo, rotadores y core.`,
    steps: [
      { kind: 'warmup', durationMin: 5, intensity: 'recovery', cue: 'Movilidad de hombros y escápulas.' },
      { kind: 'work', durationMin: 20, intensity: 'endurance', cue: 'Gomas: tracción con el codo alto como en la brazada, remo y rotadores; acaba con plancha.' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery', cue: 'Estira pecho, dorsal y hombros.' },
    ],
    tss: estimateTss({ sport: 'strength', durationMin: DRY_SWIM_MIN, intensity: 'endurance' }),
    isKey: false,
    coaching: {
      objective: 'Mantener la fuerza específica de nado mientras no tienes piscina.',
      keys: ['Tracción con gomas imitando la brazada, con el codo alto.', 'Core firme: plancha y rotaciones controladas.'],
      success: 'Acabas con la espalda activada y sin molestias en el hombro.',
      planB: null,
    },
  };
}

function noPool(text: string, ctx: EditContext): EditResult | null {
  if (!NO_POOL_RE.test(text)) return null;
  const range = fromToday(rangeIn(text, ctx.today) ?? windowRange(ctx), ctx.today);
  const swims = editable(ctx).filter((w) => w.sport === 'swim' && inRange(w, range) && !w.jointSessionId);
  if (swims.length === 0) return { changes: [], summary: `No tienes natación ${rangeWords(range, ctx.today)}: no hace falta cambiar nada.` };
  const patch = drySwimPatch();
  const changes: PlanChange[] = swims.map((w) => ({ op: 'update', workoutId: w.id, patch, reason: `Sin piscina: ${quoted(w)} pasa a fuerza en seco con gomas y core.` }));
  const count = swims.length === 1 ? 'la sesión de natación' : `las ${swims.length} sesiones de natación`;
  return {
    changes,
    summary: `Sin piscina ${rangeWords(range, ctx.today)}: cambio ${count} por fuerza en seco con gomas y core, para no perder la brazada. Si encuentras otra piscina o aguas abiertas, nada suave.`,
  };
}

// ---------------------------------------------------------------------------
// Told: little time ("solo tengo 30 minutos")
// ---------------------------------------------------------------------------

const LIMIT_RE =
  /\b(?:solo|solamente|unicamente|nada mas que|como mucho|apenas)\s+(?:tengo\s+|puedo\s+|dispongo de\s+|me da para\s+)?(\d{1,3})\s*(?:min\b|minutos|')|\btengo\s+(?:solo\s+)?(\d{1,3})\s*(?:min\b|minutos)|\b(?:solo|solamente|apenas)\s+(?:tengo\s+|puedo\s+)?(una hora y media|hora y media|tres cuartos de hora|media hora|una hora|veinte minutos|cuarenta minutos)\b/;
const WORD_MINUTES: Readonly<Record<string, number>> = {
  'una hora y media': 90,
  'media hora': 30,
  'una hora': 60,
  'hora y media': 90,
  'tres cuartos de hora': 45,
  'veinte minutos': 20,
  'cuarenta minutos': 40,
};

function minutesLimit(text: string): number | null {
  const m = LIMIT_RE.exec(text);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : (WORD_MINUTES[m[3] ?? ''] ?? NaN);
  return Number.isFinite(minutes) && minutes >= 10 && minutes <= 240 ? minutes : null;
}

function littleTime(text: string, ctx: EditContext): EditResult | null {
  const minutes = minutesLimit(text);
  if (minutes === null) return null;
  const date = dayRefs(text, ctx.today)[0]?.date ?? ctx.today;
  const day = dayLabel(date, ctx.today);
  const sessions = editable(ctx).filter((w) => w.date === date);
  if (sessions.length === 0) return { changes: [], summary: `${capitalized(day)} no tienes nada planificado: si te apetece, ${minutes}' suaves de lo que más te guste.` };
  const total = sessions.reduce((s, w) => s + w.durationMin, 0);
  if (total <= minutes) return { changes: [], summary: `Te cabe: ${sessions.map(quoted).join(' y ')} ${sessions.length === 1 ? 'dura' : 'suman'} ${total}'.` };
  // The session that matters most: quality first, else the longest; quedadas keep their time.
  const own = sessions.filter((w) => !w.jointSessionId);
  const main = [...own].sort((a, b) => Number(isQualityWorkout(b)) - Number(isQualityWorkout(a)) || b.durationMin - a.durationMin)[0];
  if (!main) return { changes: [], summary: `${capitalized(day)} solo tienes quedadas: avisa a tu compañero si no llegas.` };
  const target = Math.min(main.durationMin, round5(minutes));
  const changes: PlanChange[] = [
    { op: 'update', workoutId: main.id, patch: shortenedPatch(main, target), reason: `Solo tienes ${minutes}': ${quoted(main)} se queda en ${target}', con el calentamiento corto y la parte principal recortada.` },
    ...own
      .filter((w) => w.id !== main.id)
      .map((w): PlanChange => ({ op: 'delete', workoutId: w.id, reason: `Con ${minutes}' solo da para una sesión: priorizo ${quoted(main)}.` })),
  ];
  return { changes, summary: `Con ${minutes}' ${day}: ${quoted(main)} se queda en ${target}', con lo esencial de la sesión.` };
}

// ---------------------------------------------------------------------------
// Asked: a softer week
// ---------------------------------------------------------------------------

const EASIER_RE =
  /\b(?:semana|dias|plan|entrenos)\b[^.?!]*\bmas (?:suave|tranquil|liger|facil|flojo|floja)|\b(?:semana|dias|plan|entrenos)\b[^.?!]*\bmenos (?:dur|intens|carga)|\b(?:bajame|baja|reduceme|reduce|aflojame|afloja|rebaja|rebajame)\b[^.?!]*\b(?:la carga|el volumen|la intensidad|el ritmo|el plan)\b|\bsemana (?:mas )?(?:suave|tranquila|ligera)\b/;
const SOFTER = 0.8;

function softerWeek(text: string, ctx: EditContext): EditResult | null {
  if (!EASIER_RE.test(text)) return null;
  const range = fromToday(rangeIn(text, ctx.today) ?? windowRange(ctx), ctx.today);
  const sessions = editable(ctx).filter((w) => inRange(w, range) && !w.jointSessionId);
  const sctx = { thresholds: ctx.replanInput.profile.thresholds };
  const changes: PlanChange[] = sessions.flatMap((w): PlanChange[] => {
    if (isQualityWorkout(w)) {
      const patch = easyPatch(w, { durationMin: round5(w.durationMin * SOFTER), intensity: 'endurance' }, sctx);
      return [{ op: 'update', workoutId: w.id, patch: { ...patch, isKey: false }, reason: `Semana más suave: ${quoted(w)} pasa a zona dos y un 20 % más corta.` }];
    }
    if (isLongWorkout(w)) return [{ op: 'update', workoutId: w.id, patch: shortenedPatch(w, round5(w.durationMin * SOFTER)), reason: `Semana más suave: ${quoted(w)} un 20 % más corta.` }];
    return [];
  });
  if (changes.length === 0) {
    return { changes: [], summary: 'Tu semana ya es suave: sin series y con lo largo moderado. Si aun así vas justo, dime «hoy no puedo» o «cambia lo de hoy por algo suave».' };
  }
  return { changes, summary: 'Semana más suave: quito la intensidad y recorto un 20 % lo largo, manteniendo la constancia. Si es por cansancio, estrés o exámenes que van a durar, cuéntamelo y lo apunto.' };
}

// ---------------------------------------------------------------------------
// Asked: more or less of a sport
// ---------------------------------------------------------------------------

const SHIFT_RE = /\b(mas|menos)\s+(?:de\s+)?(bici|ciclismo|natacion|nadar|piscina|carrera|correr|run|fuerza)\b/;
const WANTS_RE = /\b(?:quiero|quisiera|me gustaria|prefiero|necesito|haz|hazme|pon|ponme|hacer|meter|meteme|mete|dame)\b/;
const SPORT_OF: Readonly<Record<string, Sport>> = { bici: 'bike', ciclismo: 'bike', natacion: 'swim', nadar: 'swim', piscina: 'swim', carrera: 'run', correr: 'run', run: 'run', fuerza: 'strength' };
const SPORT_WORD: Readonly<Record<Sport, string>> = { bike: 'bici', swim: 'natación', run: 'carrera', strength: 'fuerza', brick: 'bici y carrera', mobility: 'movilidad', other: 'deporte', rest: 'descanso' };
/** Which sport gives way first when the athlete wants more of another (runs carry the impact). */
const DONORS: Readonly<Partial<Record<Sport, readonly Sport[]>>> = { bike: ['run', 'swim'], run: ['bike', 'swim'], swim: ['bike', 'run'] };
/** Never leave a sport with fewer sessions than this in the window. */
const MIN_PER_SPORT = 2;
const RUN_MAX_FROM_BIKE = 60;

/** Same effort in another sport: bike takes 1.3× the time of a run (SUBSTITUTION_RATIO), runs are capped at 60'. */
function convertedMinutes(from: Sport, to: Sport, minutes: number): number {
  if (from === 'run' && to === 'bike') return round5(minutes * 1.3);
  if (from === 'bike' && to === 'run') return Math.min(RUN_MAX_FROM_BIKE, round5(minutes / 1.3));
  return round5(minutes);
}

function sportShift(text: string, ctx: EditContext): EditResult | null {
  const m = SHIFT_RE.exec(text);
  if (!m?.[1] || !m[2] || !WANTS_RE.test(text)) return null;
  const sport = SPORT_OF[m[2]];
  if (!sport) return null;
  const more = m[1] === 'mas';
  const word = SPORT_WORD[sport];
  const sessions = editable(ctx).filter((w) => !w.jointSessionId);
  const count = (s: Sport) => editable(ctx).filter((w) => w.sport === s).length;
  const sctx = { thresholds: ctx.replanInput.profile.thresholds };
  if (sport === 'strength') {
    if (more) return { changes: [], summary: 'Para sumar fuerza, dime qué día te viene bien y te añado 30\' de fuerza de mantenimiento.' };
    const strength = sessions.find((w) => w.sport === 'strength');
    return strength
      ? { changes: [{ op: 'delete', workoutId: strength.id, reason: `Menos fuerza esta semana: quito ${quoted(strength)}.` }], summary: `Te quito ${quoted(strength)} de ${dayLabel(strength.date, ctx.today)}.` }
      : { changes: [], summary: 'No tienes fuerza en los próximos días.' };
  }
  if (more) {
    const donor = (DONORS[sport] ?? [])
      .flatMap((s) => sessions.filter((w) => w.sport === s && isLowPriority(w) && count(s) > MIN_PER_SPORT))
      .at(0);
    if (!donor) return { changes: [], summary: `No veo una sesión suave que cambiar sin dejarte otro deporte cojo. Si quieres más ${word}, dime qué día y te la añado.` };
    const durationMin = convertedMinutes(donor.sport, sport, donor.durationMin);
    const patch = easyPatch(donor, { sport, durationMin, intensity: 'endurance' }, sctx);
    const title = patch.title ?? `${capitalized(word)} suave`;
    return {
      changes: [{ op: 'update', workoutId: donor.id, patch: { ...patch, isKey: false }, reason: `Más ${word}: ${quoted(donor)} pasa a ${title.toLowerCase()} de ${durationMin}'.` }],
      summary: `Cambio ${quoted(donor)} de ${dayLabel(donor.date, ctx.today)} por «${title}» de ${durationMin}': más ${word} sin subir la carga.`,
    };
  }
  const victim = [...sessions].reverse().find((w) => w.sport === sport && isLowPriority(w));
  if (!victim) return { changes: [], summary: `No tienes ${word} suave en los próximos días que pueda cambiar.` };
  const others = (DONORS[sport] ?? []).filter((s) => (ctx.replanInput.profile.sports as readonly Sport[]).includes(s));
  const to = [...others].sort((a, b) => count(a) - count(b))[0];
  if (!to) return { changes: [{ op: 'delete', workoutId: victim.id, reason: `Menos ${word}: quito ${quoted(victim)}.` }], summary: `Te quito ${quoted(victim)}.` };
  const durationMin = convertedMinutes(sport, to, victim.durationMin);
  const patch = easyPatch(victim, { sport: to, durationMin, intensity: 'endurance' }, sctx);
  const title = patch.title ?? `${capitalized(SPORT_WORD[to])} suave`;
  return {
    changes: [{ op: 'update', workoutId: victim.id, patch: { ...patch, isKey: false }, reason: `Menos ${word}: ${quoted(victim)} pasa a ${title.toLowerCase()} de ${durationMin}'.` }],
    summary: `Cambio ${quoted(victim)} de ${dayLabel(victim.date, ctx.today)} por «${title}» de ${durationMin}'.`,
  };
}

// ---------------------------------------------------------------------------
// Asked: tired today
// ---------------------------------------------------------------------------

const TIRED_RE =
  /\b(?:estoy|me siento|me noto|ando|voy|me encuentro)\b[^.?!]*\b(?:cansad|agotad|reventad|fundid|sin fuerzas|sin energia|hecho polvo|hecha polvo|muert|fatal)|\bdorm(?:i|ido)\s+(?:muy\s+)?(?:mal|fatal|poco|nada)\b|\bno he dormido\b|\bagujetas\b|\bpiernas (?:muy )?(?:cargadas|pesadas|duras|reventadas)\b/;
const VERY_TIRED_RE = /agotad|reventad|fundid|hech[oa] polvo|muert|fatal|\bnada\b|sin fuerzas/;

function tiredToday(text: string, ctx: EditContext): EditResult | null {
  if (!TIRED_RE.test(text)) return null;
  const sessions = editable(ctx).filter((w) => w.date === ctx.today);
  if (sessions.length === 0) return { changes: [], summary: 'Hoy no tienes entreno: descansa y acuéstate pronto, que es lo que más recupera.' };
  const base: Readiness = ctx.readiness ?? { score: null, level: 'green', factors: [], recommendation: '' };
  const level = VERY_TIRED_RE.test(text) || base.level === 'red' ? 'red' : 'amber';
  const readiness: Readiness = { ...base, level, factors: [...base.factors, 'Dices que estás cansado/a'], recommendation: 'Hoy suave y a dormir pronto.' };
  const result = replanForReadiness({ ...ctx.replanInput, today: ctx.today, weekWorkouts: [...ctx.workouts], readiness });
  if (result.changes.length > 0) return { changes: result.changes, summary: `Vale, hoy vamos suave. ${result.summary}` };
  const [main] = sessions;
  return { changes: [], summary: `Hoy toca ${quoted(main!)}, que ya es suave: hazla tranquila o, si estás peor de lo que parece, descansa.` };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const TOLD = [eveningPlan, examsOrStudy, trip, workOrStress, noPool, littleTime] as const;
const ASKED = [softerWeek, sportShift, tiredToday] as const;

/** The situation in a (plain) chat message, as a proposal or an explanation; null when there is none. */
export function situationEdit(text: string, ctx: EditContext, group: SituationGroup): EditResult | null {
  for (const handler of group === 'told' ? TOLD : ASKED) {
    const result = handler(text, ctx);
    if (result) return result;
  }
  return null;
}

/** Days between two dates, inclusive (for tests and replies). */
export function spanDays(range: DateRange): number {
  return diffDays(range.to, range.from) + 1;
}
