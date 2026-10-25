/**
 * Conversation state for the coach screen, backed by the app-wide
 * `coachStore`: messages persisted on the device (last 20), one request at a
 * time across mounts, retry on failure.
 *
 * Leaving the screen does not cancel a request: the answer lands in the store
 * and the reopened screen shows it (or the thinking state while it runs).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useAuth } from '@/data/context';
import { useCoach, useProposals } from '@/data/queries';
import type { PlanProposal } from '@/domain/types';

import type { ChatMessage } from './chatModel';
import { coachStore } from './coachSession';
import type { EngineKind } from './labels';
import { PENDING_TIMEOUT_MS, pendingRemainingMs } from './pendingMarker';
import type { PreparedRequest } from './requests';

/** How often proposals are re-read while waiting for a job started before a restart. */
const RESTORED_POLL_MS = 15_000;

export interface CoachChat {
  messages: ChatMessage[];
  /** True once the persisted history has been restored. */
  isLoaded: boolean;
  /** A request is running (possibly started before the screen was reopened). */
  isSending: boolean;
  /** The running request was started in a previous app run (we wait for its proposal). */
  isResuming: boolean;
  error: string | null;
  canRetry: boolean;
  lastEngine: EngineKind | null;
  /** False when another request is still running. */
  send: (prepared: PreparedRequest) => boolean;
  retry: () => void;
  clear: () => Promise<void>;
}

/** Waits for the proposal of a request restored from storage, or gives up after the timeout. */
function useRestoredResolution(active: boolean, startedAt: string | null, timeoutMs: number): void {
  const proposals = useProposals();
  const latest = useRef<readonly PlanProposal[]>([]);
  latest.current = proposals.data ?? [];

  useEffect(() => {
    if (active) coachStore.resolveRestored(proposals.data ?? [], timeoutMs);
  }, [active, proposals.data, timeoutMs]);

  useEffect(() => {
    if (!active || !startedAt) return undefined;
    const remaining = pendingRemainingMs(startedAt, new Date(), timeoutMs);
    const deadline = setTimeout(() => coachStore.resolveRestored(latest.current, timeoutMs), remaining + 50);
    const poll = setInterval(() => void proposals.refetch(), RESTORED_POLL_MS);
    return () => {
      clearTimeout(deadline);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startedAt, timeoutMs]);
}

export function useCoachChat(): CoachChat {
  const { mode, session } = useAuth();
  const coach = useCoach();
  const state = useSyncExternalStore(coachStore.subscribe, coachStore.getState, coachStore.getState);
  const ownerId = session?.userId ?? null;
  const isResuming = state.pending !== null && !state.inFlight;
  // The demo runs the rules on the phone: a request cut by a restart never finishes.
  const timeoutMs = mode === 'demo' ? 0 : PENDING_TIMEOUT_MS;

  useEffect(() => {
    void coachStore.bindOwner(ownerId);
  }, [ownerId]);

  useRestoredResolution(isResuming, state.pending?.startedAt ?? null, timeoutMs);

  return {
    messages: state.messages,
    isLoaded: state.isLoaded && state.ownerId === ownerId,
    isSending: state.pending !== null,
    isResuming,
    error: state.error,
    canRetry: state.failed !== null,
    lastEngine: state.lastEngine,
    send: (prepared) => coachStore.send(prepared, coach.mutateAsync),
    retry: () => void coachStore.retry(coach.mutateAsync),
    clear: () => coachStore.clear(),
  };
}
