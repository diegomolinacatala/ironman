/**
 * State + actions of the voice coach: sends spoken/typed messages through the
 * AI consent gate, keeps today's turns (restored from the device when the
 * screen opens, saved after every change; "Nueva conversación" clears them)
 * and lets the user cancel a slow answer (the AI can take ~2 min; a cancelled
 * answer is ignored).
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';

import { useAuth } from '@/data/context';
import { useCoach, useFriends } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { CoachResponse } from '@/domain/types';
import type { PreparedRequest } from '@/features/coach/requests';
import { useConsentGate, type ConsentGate } from '@/features/coach/useConsentGate';
import { splitFriends } from '@/features/social/friendModel';
import { normalizeDictation } from '@/integrations/speech/dictation';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import {
  initialTalkState,
  newTurnId,
  talkReducer,
  talkRequest,
  type InputMode,
  type ProposalResolution,
  type TalkChannel,
  type TalkState,
} from './talkSession';
import { loadTalk, saveTalk } from './talkStorage';

const FAILED_TEXT = 'Tu coach no ha podido responder. Inténtalo de nuevo.';

export interface TalkSession {
  state: TalkState;
  gate: ConsentGate;
  /** Sends a message of this conversation (asks for AI consent first when needed). */
  send: (text: string, channel: TalkChannel) => void;
  /** Sends a request prepared from a link (replan of an imprevisto…). */
  sendPrepared: (prepared: PreparedRequest, onSent?: () => void) => void;
  retry: () => void;
  cancel: () => void;
  reset: () => void;
  setMode: (mode: InputMode) => void;
  setDraft: (text: string) => void;
  prefill: (text: string) => void;
  resolve: (turnId: string, resolution: ProposalResolution) => void;
  clearNotice: () => void;
}

export function useTalkSession(voiceAvailable: boolean): TalkSession {
  const coach = useCoach();
  // Accepted friends named in a message let the coach see their calendars (quedadas).
  const friends = useFriends();
  const acceptedFriends = useMemo(() => splitFriends(friends.data).accepted, [friends.data]);
  const [state, dispatch] = useReducer(talkReducer, voiceAvailable, initialTalkState);
  const latest = useRef(state);
  latest.current = state;

  // The recogniser may turn out to be unavailable after mount (web, no permission API…).
  useEffect(() => {
    if (!voiceAvailable && latest.current.inputMode === 'voice') dispatch({ type: 'mode', mode: 'text' });
  }, [voiceAvailable]);

  // Today's conversation: restored once per user, then saved after every change of the turns.
  const userId = useAuth().session?.userId ?? null;
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    restored.current = null;
    loadTalk(userId, todayISO()).then(
      (turns) => {
        if (!alive) return;
        restored.current = userId;
        if (turns.length > 0) dispatch({ type: 'hydrate', turns });
        // Turns sent while reading had nothing to merge with: save them now.
        else if (latest.current.turns.length > 0) void saveTalk(userId, todayISO(), latest.current.turns);
      },
      (error: unknown) => {
        logger.warn('talk conversation not restored', error);
        if (alive) restored.current = userId;
      },
    );
    return () => {
      alive = false;
    };
  }, [userId]);
  useEffect(() => {
    // Never overwrite the stored conversation before it has been read.
    if (!userId || restored.current !== userId) return;
    saveTalk(userId, todayISO(), state.turns).catch((error: unknown) => logger.warn('talk conversation not saved', error));
  }, [userId, state.turns]);

  const start = (prepared: PreparedRequest): boolean => {
    if (latest.current.pending) return false;
    const id = newTurnId();
    const channel: TalkChannel = prepared.request.channel ?? 'text';
    dispatch({ type: 'sent', pending: { id, text: prepared.text, channel, request: prepared.request } });
    coach.mutateAsync(prepared.request).then(
      (response: CoachResponse) => {
        haptics.tap();
        dispatch({ type: 'answered', id, response });
      },
      (error: unknown) => {
        logger.warn('talk coach request failed', error);
        dispatch({ type: 'failed', id, error: errorMessage(error, FAILED_TEXT) });
      },
    );
    return true;
  };

  const gate = useConsentGate(start);

  return {
    state,
    gate,
    send: (text, channel) => {
      // Dictation writes "dos por cuatro kilómetros a cuatro veinticinco": the coach gets "2×4 km a 4:25 /km".
      const clean = channel === 'voice' ? normalizeDictation(text) : text;
      const prepared = talkRequest(clean, channel, latest.current.turns, todayISO(), acceptedFriends);
      if (prepared.text.length > 0) gate.submit(prepared);
    },
    sendPrepared: (prepared, onSent) => gate.submit(prepared, onSent),
    retry: () => {
      const failed = latest.current.failed;
      if (failed) gate.submit({ request: failed.request, text: failed.text });
    },
    cancel: () => dispatch({ type: 'cancel' }),
    reset: () => dispatch({ type: 'reset' }),
    setMode: (mode) => dispatch({ type: 'mode', mode }),
    setDraft: (text) => dispatch({ type: 'draft', text }),
    prefill: (text) => dispatch({ type: 'prefill', text }),
    resolve: (turnId, resolution) => dispatch({ type: 'resolved', turnId, resolution }),
    clearNotice: () => dispatch({ type: 'clear_notice' }),
  };
}
