/**
 * State + actions of the voice coach: sends spoken/typed messages through the
 * AI consent gate, keeps the turns of this visit and lets the user cancel a
 * slow answer (the AI can take ~2 min; a cancelled answer is ignored).
 */
import { useEffect, useReducer, useRef } from 'react';

import { useCoach } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { CoachResponse } from '@/domain/types';
import type { PreparedRequest } from '@/features/coach/requests';
import { useConsentGate, type ConsentGate } from '@/features/coach/useConsentGate';
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
  const [state, dispatch] = useReducer(talkReducer, voiceAvailable, initialTalkState);
  const latest = useRef(state);
  latest.current = state;

  // The recogniser may turn out to be unavailable after mount (web, no permission API…).
  useEffect(() => {
    if (!voiceAvailable && latest.current.inputMode === 'voice') dispatch({ type: 'mode', mode: 'text' });
  }, [voiceAvailable]);

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
      const prepared = talkRequest(text, channel, latest.current.turns, todayISO());
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
