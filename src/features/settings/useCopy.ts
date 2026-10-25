import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/logger';
import { haptics } from '@/ui';

const COPIED_FEEDBACK_MS = 2000;

export interface CopyState {
  /** Key of the last copied item while the "Copiado" feedback is visible. */
  copiedKey: string | null;
  error: string | null;
  copy: (text: string, key?: string) => Promise<void>;
}

/** Copies text to the clipboard with short-lived "Copiado" feedback. */
export function useCopy(): CopyState {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, key = 'default') => {
    try {
      await Clipboard.setStringAsync(text);
      haptics.success();
      setError(null);
      setCopiedKey(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedKey(null), COPIED_FEEDBACK_MS);
    } catch (err) {
      logger.warn('clipboard copy failed', err);
      setError('No se pudo copiar. Mantén pulsado el texto para copiarlo a mano.');
    }
  }, []);

  return { copiedKey, error, copy };
}
