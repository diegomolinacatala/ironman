/**
 * Coach conversation store, outside React.
 *
 * An AI answer can take ~2 min. The store outlives the coach screen, so a
 * request keeps running when the user leaves: the answer is appended to the
 * latest messages, and a reopened screen shows the thinking state and cannot
 * start a duplicate job. The in-flight marker is persisted with the history.
 * After an app restart the coach waits for the server-side job (by matching
 * its proposal) instead of sending the request again.
 */
import type { CoachRequest, CoachResponse, PlanProposal } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';

import { assistantMessage, toCoachHistory, trimHistory, userMessage, type ChatHint, type ChatMessage } from './chatModel';
import { parseStoredConversation, serializeConversation, type StoredConversation } from './conversationStorage';
import type { EngineKind } from './labels';
import {
  PENDING_TIMEOUT_MS,
  findAnsweredProposal,
  pendingMarker,
  pendingRemainingMs,
  type PendingMarker,
} from './pendingMarker';
import type { PreparedRequest } from './requests';

export type CoachRunner = (request: CoachRequest) => Promise<CoachResponse>;

export interface CoachStorage {
  read: () => Promise<unknown>;
  write: (value: StoredConversation) => Promise<void>;
  remove: () => Promise<void>;
}

export interface FailedRequest {
  request: CoachRequest;
  followUp: ChatHint | null;
}

export interface CoachStoreState {
  /** Account the conversation belongs to (history never leaks between accounts). */
  ownerId: string | null;
  messages: ChatMessage[];
  isLoaded: boolean;
  /** A request waiting for its answer (sent now, or restored from a previous run). */
  pending: PendingMarker | null;
  /** True while this app run awaits the answer; false for a marker restored from storage. */
  inFlight: boolean;
  error: string | null;
  failed: FailedRequest | null;
  lastEngine: EngineKind | null;
}

export interface CoachStore {
  getState: () => CoachStoreState;
  subscribe: (listener: () => void) => () => void;
  /** Loads the conversation of `ownerId` (resets everything when the account changes). */
  bindOwner: (ownerId: string | null) => Promise<void>;
  /** Starts a request; false when one is already pending or history is not loaded. */
  send: (prepared: PreparedRequest, runner: CoachRunner) => boolean;
  retry: (runner: CoachRunner) => boolean;
  clear: () => Promise<void>;
  /** Settles a restored marker: its proposal arrived, or it is stale and can be retried. */
  resolveRestored: (proposals: readonly PlanProposal[], timeoutMs?: number) => void;
}

export const RESTORED_ANSWER_TEXT = 'Ya tienes la propuesta del coach. Revísala y aplica los cambios que quieras.';
export const LOST_ANSWER_TEXT =
  'No nos ha llegado la respuesta del coach. Si te llega la propuesta, la verás en Hoy; si no, reinténtalo.';
const FAILED_TEXT = 'El coach no ha podido responder. Inténtalo de nuevo.';

const INITIAL: CoachStoreState = {
  ownerId: null,
  messages: [],
  isLoaded: false,
  pending: null,
  inFlight: false,
  error: null,
  failed: null,
  lastEngine: null,
};

function withHistory(request: CoachRequest, previous: readonly ChatMessage[]): CoachRequest {
  if (request.mode !== 'chat') return request;
  return { ...request, history: toCoachHistory(previous) };
}

function engineOf(proposal: PlanProposal): EngineKind {
  return proposal.source === 'rules' ? 'rules' : 'ai';
}

export function createCoachStore(storage: CoachStorage, clock: () => Date = () => new Date()): CoachStore {
  let state: CoachStoreState = INITIAL;
  /** Bumped on every account switch: late answers of a previous account are dropped. */
  let generation = 0;
  let bound: { ownerId: string | null; loading: Promise<void> } | null = null;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<CoachStoreState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const persist = () => void storage.write(serializeConversation(state.ownerId, state.messages, state.pending));

  const load = async (ownerId: string | null, gen: number) => {
    let raw: unknown = null;
    try {
      raw = await storage.read();
    } catch (error) {
      logger.warn('coach history read failed', error);
    }
    if (gen !== generation) return;
    const restored = parseStoredConversation(raw, ownerId);
    set({ messages: restored.messages, pending: restored.pending, inFlight: false, isLoaded: true });
  };

  const bindOwner = (ownerId: string | null): Promise<void> => {
    if (bound && bound.ownerId === ownerId) return bound.loading;
    generation += 1;
    state = { ...INITIAL, ownerId };
    listeners.forEach((listener) => listener());
    const loading = load(ownerId, generation);
    bound = { ownerId, loading };
    return loading;
  };

  const settle = (marker: PendingMarker, gen: number, patch: Partial<CoachStoreState>) => {
    if (gen !== generation || state.pending !== marker) return;
    set({ ...patch, pending: null, inFlight: false });
    persist();
  };

  const run = (request: CoachRequest, followUp: ChatHint | null, runner: CoachRunner) => {
    const gen = generation;
    const marker = pendingMarker(request, followUp, clock());
    set({ pending: marker, inFlight: true, error: null, failed: null });
    persist();
    runner(request).then(
      (response) => {
        const hint = response.engine === 'rules' && !response.proposal ? followUp : null;
        const reply = assistantMessage(response.reply, response.proposal, response.engine, clock(), hint);
        settle(marker, gen, { messages: trimHistory([...state.messages, reply]), lastEngine: response.engine });
      },
      (error: unknown) => {
        logger.warn('coach request failed', error);
        settle(marker, gen, { failed: { request, followUp }, error: errorMessage(error, FAILED_TEXT) });
      },
    );
  };

  const send = (prepared: PreparedRequest, runner: CoachRunner): boolean => {
    if (!state.isLoaded || state.pending) return false;
    const request = withHistory(prepared.request, state.messages);
    set({ messages: trimHistory([...state.messages, userMessage(prepared.text, clock())]) });
    run(request, prepared.followUp ?? null, runner);
    return true;
  };

  const retry = (runner: CoachRunner): boolean => {
    if (!state.failed || state.pending) return false;
    run(state.failed.request, state.failed.followUp, runner);
    return true;
  };

  const clear = async () => {
    set({ messages: [], error: null, failed: null });
    // Keep an in-flight marker so the running job is not sent twice.
    if (state.pending) persist();
    else await storage.remove();
  };

  const resolveRestored = (proposals: readonly PlanProposal[], timeoutMs: number = PENDING_TIMEOUT_MS) => {
    const marker = state.pending;
    if (!marker || state.inFlight) return;
    const answer = findAnsweredProposal(marker, proposals);
    if (answer) {
      const reply = assistantMessage(RESTORED_ANSWER_TEXT, answer, engineOf(answer), clock());
      set({ messages: trimHistory([...state.messages, reply]), pending: null, lastEngine: engineOf(answer) });
      persist();
      return;
    }
    if (pendingRemainingMs(marker.startedAt, clock(), timeoutMs) > 0) return;
    set({ pending: null, failed: { request: marker.request, followUp: marker.followUp }, error: LOST_ANSWER_TEXT });
    persist();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bindOwner,
    send,
    retry,
    clear,
    resolveRestored,
  };
}
