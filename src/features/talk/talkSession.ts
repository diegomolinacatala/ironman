/**
 * Voice-coach session (pure): the turns of this visit, the request in flight,
 * the composer (voice or keyboard) and what happened to each proposal.
 *
 * Nothing is persisted: a new visit starts a new conversation. A cancelled or
 * superseded request is ignored when its answer arrives (matched by turn id).
 */
import { startOfWeek } from '@/domain/dates';
import type { CoachMessage, CoachRequest, CoachResponse, ISODate, PlanProposal } from '@/domain/types';
import { MAX_MESSAGE_LENGTH, requestFromParams, type CoachRouteParams, type PreparedRequest } from '@/features/coach/requests';

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
  | { type: 'reset' };

export function initialTalkState(voiceAvailable: boolean): TalkState {
  return { turns: [], pending: null, failed: null, error: null, inputMode: voiceAvailable ? 'voice' : 'text', draft: '', notice: null };
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
  }
}

/** Previous turns as `CoachRequest.history` (newest `max` messages). */
export function coachHistory(turns: readonly TalkTurn[], max: number = MAX_HISTORY_MESSAGES): CoachMessage[] {
  const messages = turns.flatMap((t): CoachMessage[] => [
    { role: 'user', content: t.text },
    { role: 'assistant', content: t.response.reply },
  ]);
  return messages.filter((m) => m.content.trim().length > 0).slice(-max);
}

/** Chat request for a spoken or typed message of this session. */
export function talkRequest(text: string, channel: TalkChannel, turns: readonly TalkTurn[], today: ISODate): PreparedRequest {
  const message = clampMessage(text.trim());
  const history = coachHistory(turns);
  return {
    request: {
      mode: 'chat',
      weekStart: startOfWeek(today),
      message,
      channel,
      ...(history.length > 0 ? { history } : {}),
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

export const EXAMPLE_PROMPTS: readonly string[] = [
  'Me he torcido el tobillo',
  'Mañana no puedo entrenar por la tarde',
  'Prefiero nadar por la mañana',
];
