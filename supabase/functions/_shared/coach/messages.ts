/**
 * Builds the user-side messages for the coach call: mode instruction, the
 * compact JSON context with short workout ids (+ optional triggering
 * imprevisto and friends' masked weeks), chat history (workout UUIDs in it
 * shown as their short ids) and the athlete's message. In chat, a message that
 * asks to change the plan makes concrete changes mandatory. Always ends with a
 * user turn (no assistant prefill).
 */
import { addDays } from '../dates.ts';
import type { PlanningContext } from '../planning/context.ts';
import type { CoachMode, CoachRequest, FriendWeekItem } from '../types.ts';
import { mentionsNextWeek, wantsPlanChange } from './intent.ts';
import type { ClaudeMessage } from './ports.ts';
import { promptContext, shortenUuids, shortIdsFor } from './short-ids.ts';
import type { ShortIds } from './short-ids.ts';

export interface FriendWeek {
  friendId: string;
  name: string;
  items: FriendWeekItem[];
}

const MODE_TASK: Record<CoachMode, (weekStart: string) => string> = {
  plan_week: (w) =>
    `Modo plan_week. Planifica la semana del ${w} al ${addDays(w, 6)}: propone las sesiones que faltan (op add), cada una con steps y su prescripción (objective, keys, success, planB) con las cifras de athlete.zones, cuadrando con phase.targetMinutes y respetando lo ya planificado, la disponibilidad, las ocupaciones y las quedadas. En reply, di qué tipo de semana es y por qué.`,
  replan: (w) =>
    `Modo replan. Replanifica lo que queda de la semana del ${w} (y la siguiente si hace falta) con los cambios mínimos para absorber la situación descrita; las sesiones nuevas o cambiadas llevan su prescripción completa.`,
  chat: (w) =>
    `Modo chat sobre la semana del ${w} (y la siguiente). Responde a lo que dice el atleta. Si te pide cambiar su plan, propón los cambios concretos en changes; si solo pregunta, changes vacío salvo que la seguridad lo exija. Usa week_plans si pide planificar varias semanas por encima.`,
};

/** Chat turn that asks to change the plan: changes are mandatory and must use the context ids. */
const CHANGE_TASK =
  'El atleta pide cambiar su plan: DEBES devolver en changes los cambios concretos que lo resuelven (move, update, delete o add), usando los ids cortos del contexto (w1, w2…) y fechas dentro de la ventana, de hoy en adelante. Si de verdad no se puede hacer sin romper sus reglas, changes vacío y explica en reply por qué y qué alternativa le propones. Nunca digas en reply que ya has cambiado algo: es una propuesta que el atleta acepta.';

function friendsBlock(friends: readonly FriendWeek[]): string {
  if (friends.length === 0) return '';
  const compact = friends.map((f) => ({
    friendId: f.friendId,
    name: f.name,
    items: f.items.map((i) => ({
      kind: i.kind,
      date: i.date,
      startTime: i.startTime,
      endTime: i.endTime,
      durationMin: i.durationMin,
      sport: i.sport,
      intensity: i.intensity,
      title: i.title,
      quedada: i.jointSessionId !== null,
    })),
  }));
  return `\n\nCalendario de amigos con los que quiere coincidir (compartido según su privacidad):\n${JSON.stringify(compact)}`;
}

export interface CoachMessageExtras {
  lifeEvent?: Record<string, unknown> | null;
  friends?: FriendWeek[];
  /** Short ids of the context's workouts (computed from the context when missing). */
  ids?: ShortIds;
  /** The coming week's weather in the athlete's city (`weather/prompt.ts`), when they set one. */
  weather?: Record<string, unknown> | null;
}

function weatherBlock(weather: Record<string, unknown> | null | undefined): string {
  if (!weather) return '';
  return `\n\nEl tiempo en su ciudad (MET Norway; dryGaps = tramos secos de al menos 1 h 30 entre las 07:00 y las 22:00; approx = previsión por bloques de 6 h, menos precisa):\n${JSON.stringify(weather)}`;
}

/** «Tu contexto» › «¿Algo más que deba saber?»: listen, remember, ask; never touch the plan. */
export const CONTEXT_TASK =
  'Modo chat de «Tu contexto»: el atleta te cuenta cosas de su vida para que le conozcas (deporte, estudios o trabajo, hábitos, ' +
  'familia, lesiones…). No propongas cambios: changes [], life_event null, quedada null y week_plans null. Guarda en memory de 0 a 3 hechos ' +
  'duraderos que sirvan para entrenar mejor (sin repetir lo que ya está en coachNotes ni en athlete.context). En reply, 1-3 frases: ' +
  'agradece lo concreto, di en una frase cómo lo tendrás en cuenta en el plan y, si te falta algo importante, hazle una sola pregunta.';

function taskText(request: CoachRequest): string {
  if (request.topic === 'context') return CONTEXT_TASK;
  const base = MODE_TASK[request.mode](request.weekStart);
  if (request.mode !== 'chat') return base;
  const nextWeek = mentionsNextWeek(request.message)
    ? ` Habla de la semana que viene: del ${addDays(request.weekStart, 7)} al ${addDays(request.weekStart, 13)} (nextWeek en el contexto).`
    : '';
  return `${base}${nextWeek}${wantsPlanChange(request.message) ? ` ${CHANGE_TASK}` : ''}`;
}

export function buildCoachMessages(request: CoachRequest, context: PlanningContext, extras: CoachMessageExtras): ClaudeMessage[] {
  const ids = extras.ids ?? shortIdsFor(context);
  const parts = [
    taskText(request),
    extras.lifeEvent ? `\n\nImprevisto que motiva el cambio:\n${JSON.stringify(extras.lifeEvent)}` : '',
    friendsBlock(extras.friends ?? []),
    weatherBlock(extras.weather),
    `\n\nContexto del atleta (JSON):\n${JSON.stringify(promptContext(context, ids))}`,
  ];
  const contextMessage: ClaudeMessage = { role: 'user', content: parts.join('') };
  const history = (request.history ?? []).map((m) => ({ role: m.role, content: shortenUuids(m.content, ids) }));
  const message = request.message?.trim();
  const finalText = !message
    ? 'Sin mensaje adicional del atleta: aplica el modo indicado.'
    : request.channel === 'voice'
      ? `Mensaje del atleta (dictado por voz: transcripción automática, puede tener errores de reconocimiento): ${message}`
      : `Mensaje del atleta: ${message}`;
  return [contextMessage, ...history, { role: 'user', content: finalText }];
}
