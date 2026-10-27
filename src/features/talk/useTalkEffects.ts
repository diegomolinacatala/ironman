/**
 * Side effects of the voice coach screen, kept out of the route component.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useProposal } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { CoachRouteParams } from '@/features/coach/requests';
import type { VoiceInput } from '@/integrations/speech/useVoiceInput';

import { routePrefill, type RoutePrefill, type TalkState } from './talkSession';
import type { TalkSession } from './useTalkSession';
import { isLive, takeFinished } from './voiceModel';

const TRANSIENT_MS = 4000;

export interface VoiceTake {
  /** Stops and drops the live take: `onFinal` is not called for it. */
  discard: () => void;
}

/** Calls `onFinal` with the transcript when a take ends (tap to finish or silence). */
export function useVoiceTake(voice: VoiceInput, onFinal: (text: string) => void): VoiceTake {
  const previous = useRef(voice.state);
  const discarded = useRef(false);
  const latest = useRef(onFinal);
  latest.current = onFinal;
  const { state, transcript, reset, cancel } = voice;

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    // A new take starts clean.
    if (!isLive(before) && isLive(state)) discarded.current = false;
    // Only the end of a live take (live → not live) can produce a result.
    if (isLive(state) || !isLive(before)) return;
    const skip = discarded.current;
    discarded.current = false;
    if (!takeFinished(before, state, skip)) return;
    const text = transcript.trim();
    reset();
    latest.current(text);
  }, [state, transcript, reset]);

  return {
    discard: () => {
      // Only a live take can end later; otherwise the flag would swallow the next one.
      if (isLive(previous.current)) discarded.current = true;
      cancel();
    },
  };
}

/** Clears a transient message (notice, hint) after a few seconds. */
export function useAutoClear(value: string | null, clear: () => void, ms: number = TRANSIENT_MS): void {
  const latest = useRef(clear);
  latest.current = clear;
  useEffect(() => {
    if (!value) return undefined;
    const timer = setTimeout(() => latest.current(), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
}

function announce(message: string): void {
  void AccessibilityInfo.announceForAccessibility?.(message);
}

/** VoiceOver hears every state change of the single big control. */
export function useTalkAnnouncements(voiceState: VoiceInput['state'], state: TalkState): void {
  const turns = state.turns.length;
  const sending = state.pending !== null;
  const mounted = useRef(false);

  useEffect(() => {
    if (voiceState === 'listening') announce('Te escucho');
  }, [voiceState]);
  useEffect(() => {
    if (sending) announce('Enviado. Tu coach está pensando.');
  }, [sending]);
  useEffect(() => {
    if (mounted.current && turns > 0) announce('Tu coach ha respondido.');
    mounted.current = true;
  }, [turns]);
  useEffect(() => {
    if (state.notice) announce(state.notice);
  }, [state.notice]);
}

/** Applies `/talk?message|mode|lifeEventId` once per distinct link. */
export function useRoutePrefill(params: CoachRouteParams, apply: (prefill: RoutePrefill) => void): void {
  const handled = useRef<string | null>(null);
  const latest = useRef(apply);
  latest.current = apply;
  const key = JSON.stringify([params.mode, params.weekStart, params.lifeEventId, params.message]);

  useEffect(() => {
    if (handled.current === key) return;
    handled.current = key;
    const prefill = routePrefill(params, todayISO());
    if (prefill) latest.current(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** A proposal applied or discarded from the full review screen closes its decision here too. */
export function useReviewedElsewhere(session: TalkSession, open: { turnId: string; proposalId: string } | null): void {
  const live = useProposal(open?.proposalId);
  const status = live.data && open && live.data.id === open.proposalId ? live.data.status : null;
  const { resolve } = session;
  const turnId = open?.turnId ?? null;

  useEffect(() => {
    if (turnId && status && status !== 'pending') resolve(turnId, { kind: 'reviewed' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, turnId]);
}
