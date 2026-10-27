/**
 * Spanish chat replies of the rules coach (no AI). Pure: builds text from the
 * coach context (readiness, phase, week load, next session) and simple
 * keyword intents in the athlete's message.
 */
import { diffDays, formatDayLabel, formatDuration } from '@/domain/dates';
import { fuelingHint } from '@/domain/fueling';
import { phaseLabel, readinessLabel, sportLabel } from '@/domain/labels';
import { weekSummary } from '@/domain/load';
import { nextRace, phaseFor } from '@/domain/periodization';
import type { Workout } from '@/domain/types';

import type { CoachContext } from './rulesCoach';

type Intent = 'injury' | 'fatigue' | 'other_sport' | 'nutrition' | 'plan' | 'general';

const INTENT_PATTERNS: readonly [Intent, RegExp][] = [
  ['injury', /dolor|duele|lesi[oó]n|molest|tendin|esguince|contractura|sobrecarga/i],
  ['fatigue', /cansad|agotad|fatiga|reventad|sin energ|dorm[ií]|sue[ñn]o|estr[eé]s|agobi/i],
  ['other_sport', /p[aá]del|f[uú]tbol|partido|baloncesto|tenis|escalada/i],
  ['nutrition', /com(er|ida|o)\b|nutri|hidrat|\bgel|carbohidr|prote[ií]na|dieta|cena|desayun/i],
  ['plan', /plan|semana|organiz|cambi|mueve|mover|hueco|horario/i],
];

export function detectIntent(message: string): Intent {
  const found = INTENT_PATTERNS.find(([, re]) => re.test(message));
  return found ? found[0] : 'general';
}

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
    return 'Esta semana aún no tienes entrenos planificados: pídeme que te la genere.';
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
  const when = formatDayLabel(w.date, ctx.today);
  const at = w.startTime ? ` a las ${w.startTime}` : '';
  return `Tu próxima sesión: «${w.title}» (${sportLabel(w.sport).toLowerCase()}, ${formatDuration(w.durationMin)}) ${when.toLowerCase()}${at}.`;
}

function nutritionLine(ctx: CoachContext): string {
  const w = nextWorkout(ctx);
  if (!w) return 'Prioriza comida real, hidratos alrededor de los entrenos y proteína repartida en el día.';
  const hint = fuelingHint({ sport: w.sport, durationMin: w.durationMin, intensity: w.intensity });
  const during = hint.during ? ` Durante: ${hint.during}` : '';
  return `Para «${w.title}» — Antes: ${hint.before}${during} Después: ${hint.after} (Orientación general, no es consejo médico.)`;
}

const INJURY_ADVICE = 'Si el dolor es agudo, aumenta o no mejora en 2–3 días, consulta a un profesional.';

function intentParagraph(intent: Intent, ctx: CoachContext, injuryLogged: boolean): string {
  const name = ctx.profile.displayName;
  switch (intent) {
    case 'injury':
      return injuryLogged
        ? `${INJURY_ADVICE} Ya lo tengo apuntado en tus imprevistos: pídeme «Replanificar» y ajusto la semana sin cargar esa zona.`
        : `${INJURY_ADVICE} Registra la molestia como imprevisto (lesión) y te propongo cómo ajustar la semana sin cargar esa zona.`;
    case 'fatigue':
      return 'Escucha al cuerpo: hoy mejor bajar la intensidad o cambiar la sesión por algo suave. Si quieres, pídeme «Replanificar» y adapto la semana a cómo estás.';
    case 'other_sport':
      return 'Apunta el partido como imprevisto: cuenta como carga y así puedo recolocar tus sesiones duras para que no coincidan.';
    case 'nutrition':
      return nutritionLine(ctx);
    case 'plan':
      return 'Puedo generarte la semana respetando tus huecos, clases y quedadas, o replanificarla si ha cambiado algo. Usa los botones de abajo.';
    default:
      return `¡Hola, ${name}! Te cuento cómo vas.`;
  }
}

export function buildChatReply(input: { message: string; ctx: CoachContext; injuryLogged?: boolean }): string {
  const { ctx } = input;
  // An injury the demo coach just logged always gets the injury advice ("consulta a un profesional").
  const intent = input.injuryLogged ? 'injury' : detectIntent(input.message);
  const paragraphs = [intentParagraph(intent, ctx, input.injuryLogged === true), readinessLine(ctx), weekLine(ctx), raceLine(ctx), nextWorkoutLine(ctx)];
  return paragraphs.filter((p): p is string => Boolean(p)).join('\n\n');
}
