/**
 * Voice-coach session (pure): the turns of today's conversation, the request
 * in flight, the composer and what happened to each proposal.
 *
 * The day's turns are kept on the device (`talkStorage`, restored with
 * `hydrate`); "Nueva conversación" (`reset`) clears them. A cancelled or
 * superseded request is ignored when its answer arrives (matched by turn id).
 * The history sent to the coach includes, per turn, a compact summary of the
 * changes it proposed and whether they were applied, discarded or are pending.
 */
import { addDays, startOfWeek } from '@/domain/dates';
import type { CoachMessage, CoachRequest, CoachResponse, Friend, ISODate, PlanChange, PlanProposal, Workout } from '@/domain/types';
import { MAX_MESSAGE_LENGTH, requestFromParams, type CoachRouteParams, type PreparedRequest } from '@/features/coach/requests';

import { friendIdsForConversation } from './friendMentions';

export type TalkChannel = 'voice' | 'text';
export type InputMode = 'voice' | 'text';

/** How many previous messages (user + coach) travel with each request. */
export const MAX_HISTORY_MESSAGES = 10;

export type ProposalResolution =
  | { kind: 'applied'; applied: number; failed: number }
  | { kind: 'discarded' }
  /** Applied or discarded from the full review screen (`/proposal/[id]`). */
  | { kind: 'reviewed' };

export interface TalkTurn {
  id: string;
  text: string;
  channel: TalkChannel;
  response: CoachResponse;
  resolution: ProposalResolution | null;
}

export interface PendingTurn {
  id: string;
  text: string;
  channel: TalkChannel;
  request: CoachRequest;
}

export interface TalkState {
  turns: TalkTurn[];
  pending: PendingTurn | null;
  /** Last request that failed, kept for "Reintentar". */
  failed: PendingTurn | null;
  error: string | null;
  inputMode: InputMode;
  /** Keyboard composer text (also where prefills land). */
  draft: string;
  /** Short confirmation after applying / discarding ("3 cambios aplicados"). */
  notice: string | null;
}

export type TalkAction =
  | { type: 'mode'; mode: InputMode }
  | { type: 'draft'; text: string }
  | { type: 'prefill'; text: string }
  | { type: 'sent'; pending: PendingTurn }
  | { type: 'answered'; id: string; response: CoachResponse }
  | { type: 'failed'; id: string; error: string }
  | { type: 'cancel' }
  | { type: 'resolved'; turnId: string; resolution: ProposalResolution }
  | { type: 'clear_notice' }
  | { type: 'reset' }
  /** Today's turns restored from the device (older than any turn of this visit). */
  | { type: 'hydrate'; turns: TalkTurn[] };

/**
 * `inputMode` is kept for compatibility: the composer is one field with a mic
 * button now, so it always starts as 'text'.
 */
export function initialTalkState(_voiceAvailable: boolean = false): TalkState {
  return { turns: [], pending: null, failed: null, error: null, inputMode: 'text', draft: '', notice: null };
}

function hydrate(state: TalkState, stored: readonly TalkTurn[]): TalkState {
  const known = new Set(state.turns.map((t) => t.id));
  const restored = stored.filter((t) => !known.has(t.id));
  return restored.length === 0 ? state : { ...state, turns: [...restored, ...state.turns] };
}

export function clampMessage(text: string): string {
  return text.slice(0, MAX_MESSAGE_LENGTH);
}

export function resolutionNotice(resolution: ProposalResolution): string {
  if (resolution.kind === 'discarded') return 'Vale, dejo tu plan como estaba.';
  if (resolution.kind === 'reviewed') return 'Propuesta revisada.';
  const { applied, failed } = resolution;
  if (applied === 0) return 'No se ha podido aplicar ningún cambio. Revísalo en tu plan.';
  const done = applied === 1 ? '1 cambio aplicado' : `${applied} cambios aplicados`;
  return failed > 0 ? `${done}; ${failed} no se ${failed === 1 ? 'ha' : 'han'} podido aplicar.` : `Hecho: ${done} a tu plan.`;
}

function resolveTurn(state: TalkState, turnId: string, resolution: ProposalResolution): TalkState {
  return {
    ...state,
    turns: state.turns.map((t) => (t.id === turnId ? { ...t, resolution } : t)),
    notice: resolutionNotice(resolution),
  };
}

function cancel(state: TalkState): TalkState {
  if (!state.pending) return state;
  // The message goes back to the keyboard composer so it can be edited or sent again.
  return { ...state, pending: null, inputMode: 'text', draft: state.pending.text };
}

export function talkReducer(state: TalkState, action: TalkAction): TalkState {
  switch (action.type) {
    case 'mode':
      return { ...state, inputMode: action.mode };
    case 'draft':
      return { ...state, draft: clampMessage(action.text) };
    case 'prefill':
      return { ...state, inputMode: 'text', draft: clampMessage(action.text.trim()), notice: null };
    case 'sent':
      return { ...state, pending: action.pending, failed: null, error: null, notice: null, draft: '' };
    case 'answered': {
      const pending = state.pending;
      if (!pending || pending.id !== action.id) return state;
      const turn: TalkTurn = { id: pending.id, text: pending.text, channel: pending.channel, response: action.response, resolution: null };
      return { ...state, pending: null, turns: [...state.turns, turn] };
    }
    case 'failed':
      if (!state.pending || state.pending.id !== action.id) return state;
      return { ...state, pending: null, failed: state.pending, error: action.error };
    case 'cancel':
      return cancel(state);
    case 'resolved':
      return resolveTurn(state, action.turnId, action.resolution);
    case 'clear_notice':
      return { ...state, notice: null };
    case 'reset':
      return { ...initialTalkState(false), inputMode: state.inputMode };
    case 'hydrate':
      return hydrate(state, action.turns);
  }
}

/** Longest proposal summary added to a history message (the server accepts 4000 per message). */
export const MAX_PROPOSAL_NOTE = 700;
const MAX_HISTORY_CONTENT = 4000;

/** One change in a few words; workout ids stay as they are (the server shows them as w1, w2…). */
function changeLine(c: PlanChange): string {
  switch (c.op) {
    case 'add':
      return `añadir «${c.workout.title}» el ${c.workout.date} (${c.workout.sport}, ${c.workout.durationMin}')`;
    case 'move':
      return `mover ${c.workoutId} al ${c.toDate}${c.toStartTime ? ` a las ${c.toStartTime}` : ''}`;
    case 'update': {
      const parts = [
        c.patch.title ? `«${c.patch.title}»` : '',
        c.patch.date ? `el ${c.patch.date}` : '',
        c.patch.durationMin !== undefined ? `${c.patch.durationMin}'` : '',
        c.patch.intensity ? c.patch.intensity : '',
      ].filter(Boolean);
      return `cambiar ${c.workoutId}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    }
    case 'delete':
      return `quitar ${c.workoutId}`;
  }
}

/** What happened to the turn's proposal, in the coach's words. */
function proposalState(turn: Pick<TalkTurn, 'resolution'>, proposal: PlanProposal): string {
  const r = turn.resolution;
  if (r?.kind === 'applied') return r.failed > 0 ? `aplicada en parte (${r.applied} de ${r.applied + r.failed})` : 'aplicada';
  if (r?.kind === 'discarded') return 'descartada por el atleta';
  if (r?.kind === 'reviewed') return 'revisada por el atleta en la pantalla de propuesta';
  if (proposal.status === 'applied') return 'aplicada';
  if (proposal.status === 'partially_applied') return 'aplicada en parte';
  if (proposal.status === 'discarded') return 'descartada por el atleta';
  return 'pendiente: el atleta aún no la ha aceptado';
}

/** "[Propuesta aplicada: 1) mover … al 2026-10-29; 2) quitar …]", or null without changes. */
export function proposalNote(turn: Pick<TalkTurn, 'response' | 'resolution'>): string | null {
  const proposal = turn.response.proposal;
  if (!proposal || proposal.changes.length === 0) return null;
  const lines = proposal.changes.map((c, i) => `${i + 1}) ${changeLine(c)}`).join('; ');
  const note = `[Propuesta ${proposalState(turn, proposal)}: ${lines}]`;
  return note.length <= MAX_PROPOSAL_NOTE ? note : `${note.slice(0, MAX_PROPOSAL_NOTE - 2)}…]`;
}

/** The coach's message in the history: its reply plus what it proposed and what became of it. */
function assistantContent(turn: TalkTurn): string {
  const note = proposalNote(turn);
  const reply = turn.response.reply.trim();
  const content = note ? (reply ? `${reply}\n\n${note}` : note) : reply;
  return content.slice(0, MAX_HISTORY_CONTENT);
}

/** Previous turns as `CoachRequest.history` (newest `max` messages). */
export function coachHistory(turns: readonly TalkTurn[], max: number = MAX_HISTORY_MESSAGES): CoachMessage[] {
  const messages = turns.flatMap((t): CoachMessage[] => [
    { role: 'user', content: t.text.slice(0, MAX_HISTORY_CONTENT) },
    { role: 'assistant', content: assistantContent(t) },
  ]);
  return messages.filter((m) => m.content.trim().length > 0).slice(-max);
}

/**
 * Chat request for a spoken or typed message of this session. Friends named in
 * it (or in the previous message, for follow-ups) travel as `friendIds` so the
 * coach can see their calendars and suggest a quedada.
 */
export function talkRequest(
  text: string,
  channel: TalkChannel,
  turns: readonly TalkTurn[],
  today: ISODate,
  friends: readonly Friend[] = [],
): PreparedRequest {
  const message = clampMessage(text.trim());
  const history = coachHistory(turns);
  const friendIds = friendIdsForConversation(message, turns.map((t) => t.text), friends);
  return {
    request: {
      mode: 'chat',
      weekStart: startOfWeek(today),
      message,
      channel,
      ...(history.length > 0 ? { history } : {}),
      ...(friendIds.length > 0 ? { friendIds } : {}),
    },
    text: message,
  };
}

/** The proposal still waiting for "Aplicar cambios" / "Ahora no" (latest turn only). */
export function openProposal(state: Pick<TalkState, 'turns' | 'pending'>): { turn: TalkTurn; proposal: PlanProposal } | null {
  if (state.pending) return null;
  const turn = state.turns.at(-1);
  const proposal = turn?.response.proposal;
  if (!turn || !proposal || turn.resolution || proposal.status !== 'pending' || proposal.changes.length === 0) return null;
  return { turn, proposal };
}

export type RoutePrefill = { kind: 'draft'; text: string } | { kind: 'request'; prepared: PreparedRequest };

/**
 * `/talk?message=…` prefills the keyboard composer; replan/plan links
 * (`mode`, `lifeEventId`, from the old `/coach` route) become a request card.
 * Links can come from outside the app, so nothing is ever sent without a tap.
 */
export function routePrefill(params: CoachRouteParams, today: ISODate): RoutePrefill | null {
  const prepared = requestFromParams(params, today);
  if (!prepared) return null;
  const { mode, message, lifeEventId } = prepared.request;
  if (mode === 'chat' && !lifeEventId) return message ? { kind: 'draft', text: message } : null;
  return { kind: 'request', prepared };
}

let sequence = 0;

export function newTurnId(now: number = Date.now()): string {
  sequence = (sequence + 1) % 1_000_000;
  return `t-${now.toString(36)}-${sequence.toString(36)}`;
}

/** Rotating progress copy while the coach works (the AI can take ~2 min). */
export const THINKING_LINES: readonly string[] = [
  'Entendiendo…',
  'Mirando tu semana…',
  'Revisando tu carga…',
  'Ajustando tu plan…',
  'Casi lo tengo…',
];

export const THINKING_ROTATE_MS = 2800;

export function thinkingLine(elapsedMs: number, lines: readonly string[] = THINKING_LINES): string {
  if (lines.length === 0) return 'Pensando…';
  return lines[Math.floor(Math.max(0, elapsedMs) / THINKING_ROTATE_MS) % lines.length] ?? 'Pensando…';
}

/** Plan changes the coach (AI or rules engine) turns into a proposal. */
/**
 * Examples built from the athlete's real days, so a tap can send them as they are:
 * today's pending session → skip it or make it easy; tomorrow's → move it; otherwise
 * the generic examples. Phrased the way the rules coach understands them too.
 */
export function examplePrompts(workouts: readonly Workout[], today: ISODate): string[] {
  const pending = (date: ISODate) => workouts.some((w) => w.date === date && w.status === 'planned' && w.sport !== 'rest');
  const out: string[] = [];
  if (pending(today)) out.push('Hoy no puedo entrenar', 'Cambia lo de hoy por algo suave');
  if (pending(addDays(today, 1))) out.push('Pasa la sesión de mañana a pasado mañana');
  for (const generic of EXAMPLE_PROMPTS) if (out.length < 3 && !out.includes(generic)) out.push(generic);
  return out.slice(0, 3);
}

export const EXAMPLE_PROMPTS: readonly string[] = [
  'Mueve el rodaje de mañana al jueves',
  'Hoy no puedo entrenar',
  'Tengo pádel el jueves por la tarde',
];
