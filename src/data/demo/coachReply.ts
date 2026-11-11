/**
 * Spanish chat replies of the rules coach (no AI), written the way a coach
 * answers: today's session with its objective, main target, sensations and
 * success criterion; the athlete's zones; plan B and an easier version when
 * they are tired, sore or slept badly; the season plan for the next weeks;
 * and a status update. Pure: builds text from the coach context and keyword
 * intents of the message (`coachIntents`).
 */
import { diffDays, formatDuration, formatWeekRange } from '@/domain/dates';
import { fuelingHint } from '@/domain/fueling';
import { phaseLabel, readinessLabel } from '@/domain/labels';
import { weekSummary } from '@/domain/load';
import { nextRace, phaseFor } from '@/domain/periodization';
import { WEEK_PLAN_OPTIONS } from '@/domain/season';
import type { WeekPlanDraft, Workout } from '@/domain/types';

import { SORENESS_RE, detectIntent, type Intent, type WeekPlanRequest } from './coachIntents';
import {
  easierVersion,
  planBLines,
  seasonLines,
  seasonOf,
  sessionBrief,
  sessionHeadline,
  sessionTargets,
  zoneLines,
  type ZoneSportKey,
} from './coachLines';
import type { CoachContext } from './rulesCoach';

export { detectIntent } from './coachIntents';

export interface ChatReplyInput {
  message: string;
  ctx: CoachContext;
  /** The injury in the message is already logged as an imprevisto (demo coach). */
  injuryLogged?: boolean;
}

const INJURY_ADVICE = 'Si el dolor es agudo, aumenta o no mejora en 2–3 días, consulta a un profesional.';
const REPLAN_HINT = 'Si necesitas mover más cosas, dime «reorganiza mi semana» y te propongo los cambios.';
const PLAN_HINT =
  'Puedo prepararte la semana respetando tus huecos, clases y quedadas, o reorganizarla si ha cambiado algo. Dímelo así: «planifícame la semana» o «reorganiza mi semana».';
const OTHER_SPORT_HINT =
  'Apunta el partido como imprevisto: cuenta como carga y así puedo recolocar tus sesiones duras para que no coincidan.';
const MAX_TODAY_SESSIONS = 2;
const SLEEP_RE = /dorm|sue[ñn]o/i;

// ---------------------------------------------------------------------------
// Status lines
// ---------------------------------------------------------------------------

function readinessLine(ctx: CoachContext): string {
  const r = ctx.readiness;
  if (r.level === 'unknown' || r.score === null) {
    return 'Aún no tengo datos de recuperación de hoy: haz el check-in diario o sincroniza tu reloj.';
  }
  const factors = r.factors.length > 0 ? ` (${r.factors.slice(0, 2).join('; ')})` : '';
  return `Tu estado hoy: ${readinessLabel(r.level).toLowerCase()}, ${Math.round(r.score)}/100${factors}. ${r.recommendation}`;
}

function weekLine(ctx: CoachContext): string {
  const s = weekSummary(ctx.weekWorkouts, ctx.weekStart, ctx.today);
  if (s.plannedMin === 0 && s.completedMin === 0) {
    return 'Esta semana aún no tienes entrenos planificados: dime «planifícame la semana» y te la preparo.';
  }
  return `Esta semana llevas ${formatDuration(s.completedMin)} de ${formatDuration(s.plannedMin)} planificadas (${s.completedSessions}/${s.sessions} sesiones).`;
}

function raceLine(ctx: CoachContext): string | null {
  const race = nextRace(ctx.races, ctx.today);
  if (!race) return null;
  const phase = phaseFor(ctx.today, ctx.races);
  const days = diffDays(race.date, ctx.today);
  return `Faltan ${days} días para «${race.name}» (fase de ${phaseLabel(phase.phase).toLowerCase()}). ${phase.focus}`;
}

function nextWorkout(ctx: CoachContext): Workout | null {
  return ctx.upcoming.find((w) => w.date >= ctx.today && w.sport !== 'rest') ?? null;
}

function nextWorkoutLine(ctx: CoachContext): string | null {
  const w = nextWorkout(ctx);
  if (!w) return null;
  const targets = sessionTargets(w, ctx);
  return `Tu próxima sesión: ${sessionHeadline(w, ctx.today)}${targets ? `. Clave: ${targets}` : ''}.`;
}

function nutritionLine(ctx: CoachContext): string {
  const w = nextWorkout(ctx);
  if (!w) return 'Prioriza comida real, hidratos alrededor de los entrenos y proteína repartida en el día.';
  const hint = fuelingHint({ sport: w.sport, durationMin: w.durationMin, intensity: w.intensity });
  const during = hint.during ? ` Durante: ${hint.during}` : '';
  return `Para «${w.title}» — Antes: ${hint.before}${during} Después: ${hint.after} (Orientación general, no es consejo médico.)`;
}

// ---------------------------------------------------------------------------
// Today's session
// ---------------------------------------------------------------------------

function byStartTime(a: Workout, b: Workout): number {
  return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
}

/** Today's sessions (planned or done, not skipped), in order. */
function todaysSessions(ctx: CoachContext): Workout[] {
  const byId = new Map([...ctx.weekWorkouts, ...ctx.upcoming].map((w) => [w.id, w] as const));
  return [...byId.values()]
    .filter((w) => w.date === ctx.today && w.sport !== 'rest' && w.status !== 'skipped')
    .sort(byStartTime);
}

function plannedToday(ctx: CoachContext): Workout[] {
  return todaysSessions(ctx).filter((w) => w.status === 'planned');
}

/** Amber/red readiness: the session's plan B (or the easier version) before it starts. */
function lowReadinessNote(ctx: CoachContext, w: Workout): string | null {
  const level = ctx.readiness.level;
  if (level !== 'amber' && level !== 'red') return null;
  const planB = w.coaching?.planB;
  const option = planB ? `Plan B: ${planB}` : `Si no te ves, versión suave: ${easierVersion(w, ctx)}`;
  return `Ojo, hoy vienes en ${readinessLabel(level).toLowerCase()}. ${option}`;
}

function todayParagraphs(ctx: CoachContext): (string | null)[] {
  const planned = plannedToday(ctx);
  const first = planned[0];
  if (first) {
    const lead = planned.length > 1 ? `Hoy tienes ${planned.length} sesiones.` : null;
    const briefs = planned.slice(0, MAX_TODAY_SESSIONS).map((w) => sessionBrief(w, ctx));
    return [lead, ...briefs, lowReadinessNote(ctx, first) ?? readinessLine(ctx)];
  }
  const done = todaysSessions(ctx).find((w) => w.status === 'completed');
  const lead = done
    ? `Hoy ya has hecho «${done.title}»: buen trabajo. Ahora toca recuperar: come bien, hidrátate y duerme.`
    : 'Hoy no tienes entreno: es día de descanso. Dormir y comer bien también es entrenar.';
  return [lead, nextWorkoutLine(ctx)];
}

// ---------------------------------------------------------------------------
// Tired, sore or slept badly
// ---------------------------------------------------------------------------

function fatigueLead(message: string): string {
  if (SORENESS_RE.test(message)) {
    return 'Las piernas cargadas son normales tras días de carga: hoy toca soltar, no apretar.';
  }
  if (SLEEP_RE.test(message)) return 'Una mala noche no arruina nada, pero hoy no es día de apretar.';
  return 'Escucha al cuerpo: si hoy vas justo de energía, entrenar suave te deja entrenar mejor mañana.';
}

function fatigueParagraphs(ctx: CoachContext, message: string): (string | null)[] {
  const session = plannedToday(ctx)[0] ?? nextWorkout(ctx);
  const option = session
    ? planBLines(session, ctx).join('\n')
    : 'No tienes nada planificado: descansa, hidrátate y duerme bien.';
  return [fatigueLead(message), readinessLine(ctx), option, REPLAN_HINT];
}

// ---------------------------------------------------------------------------
// Zones ("¿a qué pulsaciones / ritmo / vatios…?")
// ---------------------------------------------------------------------------

const ZONE_SPORT_HINTS: readonly [ZoneSportKey, RegExp][] = [
  ['run', /correr|carrera a pie|rodaje|tirada|\/ ?km|kil[oó]metro/i],
  ['bike', /bici|vatios|potencia|\bftp\b|rodillo/i],
  ['swim', /nad|piscina|\bcss\b|100 ?m\b/i],
];
const HR_RE = /pulsaciones|\bppm\b|frecuencia card|\bfc\b|\bpulso\b/i;

/** Sports the question is about; heart rate alone → run and bike (swimming is paced by CSS). */
export function zoneSports(message: string): ZoneSportKey[] {
  const asked = ZONE_SPORT_HINTS.filter(([, re]) => re.test(message)).map(([sport]) => sport);
  if (asked.length > 0) return asked;
  return HR_RE.test(message) ? ['run', 'bike'] : ['run', 'bike', 'swim'];
}

function zonesParagraphs(ctx: CoachContext, message: string): (string | null)[] {
  const today = plannedToday(ctx)[0];
  const targets = today ? sessionTargets(today, ctx) : null;
  return [
    'Tus zonas con tus umbrales actuales:',
    zoneLines(ctx, zoneSports(message)).join('\n'),
    today && targets ? `Hoy, en «${today.title}»: ${targets}.` : null,
  ];
}

// ---------------------------------------------------------------------------
// Replies by intent
// ---------------------------------------------------------------------------

function injuryParagraph(injuryLogged: boolean): string {
  return injuryLogged
    ? `${INJURY_ADVICE} Ya lo tengo apuntado en tus imprevistos: dime «reorganiza mi semana» y la ajusto sin cargar esa zona.`
    : `${INJURY_ADVICE} Registra la molestia como imprevisto (lesión) y dime «reorganiza mi semana»: te la ajusto sin cargar esa zona.`;
}

function intentParagraphs(intent: Intent, input: ChatReplyInput): (string | null)[] {
  const { ctx, message } = input;
  switch (intent) {
    case 'injury':
      return [injuryParagraph(input.injuryLogged === true), readinessLine(ctx), nextWorkoutLine(ctx)];
    case 'fatigue':
      return fatigueParagraphs(ctx, message);
    case 'today':
      return todayParagraphs(ctx);
    case 'zones':
      return zonesParagraphs(ctx, message);
    case 'season':
      return seasonLines(ctx);
    case 'other_sport':
      return [OTHER_SPORT_HINT, weekLine(ctx)];
    case 'nutrition':
      return [nutritionLine(ctx)];
    case 'plan':
      return [PLAN_HINT, weekLine(ctx), raceLine(ctx)];
    default:
      return [`¡Hola, ${ctx.profile.displayName}! Te cuento cómo vas.`, readinessLine(ctx), weekLine(ctx), raceLine(ctx), nextWorkoutLine(ctx)];
  }
}

export function buildChatReply(input: ChatReplyInput): string {
  // An injury the demo coach just logged always gets the injury advice ("consulta a un profesional").
  const intent: Intent = input.injuryLogged ? 'injury' : detectIntent(input.message);
  return intentParagraphs(intent, input)
    .filter((p): p is string => Boolean(p))
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Season plan suggestion ("pon la semana del 23 de descarga")
// ---------------------------------------------------------------------------

export interface WeekPlanSuggestion {
  reply: string;
  /** What the athlete can save in Plan → General (source 'ai_coach'); null when that week cannot change. */
  draft: WeekPlanDraft | null;
}

function helpText(help: string): string {
  return help.charAt(0).toLowerCase() + help.slice(1).replace(/\.$/, '');
}

/** The week-level entry the athlete asked for, unless the race fixes that week (taper, race…). */
export function weekPlanSuggestion(request: WeekPlanRequest, ctx: CoachContext): WeekPlanSuggestion {
  const range = formatWeekRange(request.weekStart);
  const week = seasonOf(ctx).weeks.find((w) => w.weekStart === request.weekStart);
  if (week && !week.editable) {
    return {
      reply: `La semana ${range} es «${week.label}» en tu plan general: esa la marca tu carrera y no conviene cambiarla. ${week.why}`,
      draft: null,
    };
  }
  const option = WEEK_PLAN_OPTIONS[request.kind];
  return {
    reply: [
      `Te propongo marcar la semana ${range} como «${option.label}» en tu plan general (${helpText(option.help)}).`,
      'Guárdala si te encaja y, cuando llegue, te planifico la semana así.',
    ].join('\n\n'),
    draft: { weekStart: request.weekStart, kind: request.kind, targetMinutes: null, note: null, source: 'ai_coach' },
  };
}
