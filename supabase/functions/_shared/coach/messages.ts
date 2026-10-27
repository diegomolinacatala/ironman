/**
 * Builds the user-side messages for the coach call: mode instruction, the
 * compact JSON context (+ optional triggering imprevisto and friends' masked
 * weeks), chat history and the athlete's message. Always ends with a user turn
 * (no assistant prefill).
 */
import { addDays } from '../dates.ts';
import type { PlanningContext } from '../planning/context.ts';
import type { CoachMode, CoachRequest, FriendWeekItem } from '../types.ts';
import type { ClaudeMessage } from './ports.ts';

export interface FriendWeek {
  friendId: string;
  name: string;
  items: FriendWeekItem[];
}

const MODE_TASK: Record<CoachMode, (weekStart: string) => string> = {
  plan_week: (w) =>
    `Modo plan_week. Planifica la semana del ${w} al ${addDays(w, 6)}: propone las sesiones que faltan (op add) respetando lo ya planificado, la disponibilidad, las ocupaciones y las quedadas.`,
  replan: (w) =>
    `Modo replan. Replanifica lo que queda de la semana del ${w} (y la siguiente si hace falta) con los cambios mínimos para absorber la situación descrita.`,
  chat: (w) =>
    `Modo chat sobre la semana del ${w}. Responde a la pregunta del atleta; incluye cambios solo si los pide o son necesarios por seguridad.`,
};

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

export function buildCoachMessages(
  request: CoachRequest,
  context: PlanningContext,
  extras: { lifeEvent?: Record<string, unknown> | null; friends?: FriendWeek[] },
): ClaudeMessage[] {
  const parts = [
    MODE_TASK[request.mode](request.weekStart),
    extras.lifeEvent ? `\n\nImprevisto que motiva el cambio:\n${JSON.stringify(extras.lifeEvent)}` : '',
    friendsBlock(extras.friends ?? []),
    `\n\nContexto del atleta (JSON):\n${JSON.stringify(context)}`,
  ];
  const contextMessage: ClaudeMessage = { role: 'user', content: parts.join('') };
  const history = (request.history ?? []).map((m) => ({ role: m.role, content: m.content }));
  const message = request.message?.trim();
  const finalText = !message
    ? 'Sin mensaje adicional del atleta: aplica el modo indicado.'
    : request.channel === 'voice'
      ? `Mensaje del atleta (dictado por voz: transcripción automática, puede tener errores de reconocimiento): ${message}`
      : `Mensaje del atleta: ${message}`;
  return [contextMessage, ...history, { role: 'user', content: finalText }];
}
