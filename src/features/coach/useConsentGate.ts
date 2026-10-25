/**
 * Puts the Coach IA consent sheet in front of the first AI request.
 *
 * - Demo or consent already given → the request is sent at once.
 * - Supabase without consent → the sheet opens; "Aceptar" stores
 *   `aiConsentAt` and sends, "Seguir sin IA" sends anyway (the coach function
 *   answers 403 and the rules engine replies), closing sends nothing.
 */
import { router } from 'expo-router';
import { useState } from 'react';

import type { AiConsentSheetProps } from './AiConsentSheet';
import type { EngineConsent } from './labels';
import type { PreparedRequest } from './requests';
import { useAiConsent } from './useAiConsent';

export interface ConsentGate {
  consent: EngineConsent;
  /** Sends now or asks first; `onSent` runs once the request has actually been sent. */
  submit: (prepared: PreparedRequest, onSent?: () => void) => void;
  /** Opens the sheet without a request (to turn the AI on). */
  open: () => void;
  sheet: AiConsentSheetProps;
}

interface Waiting {
  prepared: PreparedRequest;
  onSent?: () => void;
}

export function useConsentGate(send: (prepared: PreparedRequest) => boolean): ConsentGate {
  const consent = useAiConsent();
  const [visible, setVisible] = useState(false);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state: EngineConsent = consent.state === 'needed' && declined ? 'declined' : consent.state;

  const dispatch = (next: Waiting | null) => {
    if (next && send(next.prepared)) next.onSent?.();
  };

  const close = () => {
    setVisible(false);
    setWaiting(null);
    setError(null);
  };

  const accept = async () => {
    setError(null);
    const failure = await consent.grant();
    if (failure) {
      setError(failure);
      return;
    }
    setDeclined(false);
    const next = waiting;
    close();
    dispatch(next);
  };

  const decline = () => {
    setDeclined(true);
    const next = waiting;
    close();
    dispatch(next);
  };

  return {
    consent: state,
    submit: (prepared, onSent) => {
      if (state === 'needed') {
        setWaiting({ prepared, onSent });
        setError(null);
        setVisible(true);
        return;
      }
      dispatch({ prepared, onSent });
    },
    open: () => {
      setWaiting(null);
      setError(null);
      setVisible(true);
    },
    sheet: {
      visible,
      saving: consent.saving,
      error,
      onAccept: () => void accept(),
      onDecline: decline,
      onClose: close,
      onMore: () => {
        close();
        router.push('/privacy');
      },
    },
  };
}
