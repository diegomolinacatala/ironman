import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';

import { useConnectGarmin, useIntegrations } from '@/data/queries';
import type { IntegrationStatus } from '@/domain/types';
import { logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { addDaysISO } from '../../settings/format';
import { GARMIN_KEY_URL, garminKeyError } from '../../settings/garminModel';
import { GARMIN_KEY_DAYS, demoSafeKey, garminErrorMessage } from '../connectModel';

/** intro → (browser) → paste → connecting → connected. Errors keep the paste phase. */
export type GarminPhase = 'intro' | 'paste' | 'connecting' | 'connected';

export interface GarminConnect {
  phase: GarminPhase;
  status: IntegrationStatus | undefined;
  /** Status still loading (do not show "Sin conectar" yet). */
  checking: boolean;
  /** The saved key expired / was rejected: the athlete must create a new one. */
  needsRenewal: boolean;
  error: string | null;
  /** At least one attempt failed (bad key, Garmin down…): the onboarding offers "Seguir sin Garmin". */
  failed: boolean;
  keyText: string;
  setKeyText: (text: string) => void;
  openGarmin: () => Promise<void>;
  showPaste: () => void;
  /** Validates and connects (first sync runs server-side). */
  submit: (raw: string) => Promise<void>;
  /** Reads the clipboard (may show the iOS paste prompt; prefer the native paste control). */
  pasteFromClipboard: () => Promise<void>;
  /** Back to the paste phase to connect a new key (renew). */
  reconnect: () => void;
}

export interface GarminConnectOptions {
  isDemo: boolean;
  today: string;
}

/** Garmin Personal API connection flow shared by onboarding and Conexiones. */
export function useGarminConnect({ isDemo, today }: GarminConnectOptions): GarminConnect {
  const integrations = useIntegrations();
  const connect = useConnectGarmin();
  const status = integrations.data?.find((i) => i.provider === 'garmin_personal');
  const [phase, setPhase] = useState<GarminPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [keyText, setKeyText] = useState('');
  const isConnected = status?.state === 'connected';
  // Until the athlete acts, the phase follows the server status.
  const current: GarminPhase = phase ?? (isConnected ? 'connected' : 'intro');

  const openGarmin = async () => {
    setError(null);
    try {
      await WebBrowser.openBrowserAsync(GARMIN_KEY_URL, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch (err) {
      logger.warn('garmin: open key page failed', err);
    }
    // Back from the browser: the key should be on the clipboard now.
    setPhase((p) => (p === 'connected' || p === 'connecting' ? p : 'paste'));
  };

  const submit = async (raw: string) => {
    const key = raw.trim();
    const problem = isDemo ? null : garminKeyError(key);
    if (problem) {
      haptics.warning();
      setFailed(true);
      setError(problem);
      setPhase('paste');
      return;
    }
    setError(null);
    setPhase('connecting');
    try {
      await connect.mutateAsync({ apiKey: isDemo ? demoSafeKey(key) : key, expiresAt: addDaysISO(today, GARMIN_KEY_DAYS) });
      haptics.success();
      setKeyText('');
      setPhase('connected');
    } catch (err) {
      logger.warn('garmin: connect failed', err);
      haptics.warning();
      setFailed(true);
      setError(garminErrorMessage(err));
      setPhase('paste');
    }
  };

  const pasteFromClipboard = async () => {
    let text = '';
    try {
      text = (await Clipboard.getStringAsync()).trim();
    } catch (err) {
      logger.warn('garmin: read clipboard failed', err);
    }
    if (!text) {
      haptics.warning();
      setError('No hay nada copiado. En Garmin pulsa «Copiar» y vuelve a intentarlo, o escribe la clave abajo.');
      setPhase('paste');
      return;
    }
    setKeyText(text);
    await submit(text);
  };

  return {
    phase: current,
    status,
    checking: integrations.isLoading,
    needsRenewal: status?.state === 'expired' || status?.state === 'error',
    error,
    failed,
    keyText,
    setKeyText,
    openGarmin,
    showPaste: () => {
      setError(null);
      setPhase('paste');
    },
    submit,
    pasteFromClipboard,
    reconnect: () => {
      setError(null);
      setPhase('intro');
    },
  };
}
