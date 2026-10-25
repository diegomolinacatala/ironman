/**
 * Reads and stores the Coach IA consent (`profile.aiConsentAt`).
 */
import { useAuth } from '@/data/context';
import { useProfile, useUpdateProfile } from '@/data/queries';
import type { ISODateTime } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';

import { aiConsentState, type AiConsentState } from './aiConsent';

export interface AiConsent {
  state: AiConsentState;
  consentAt: ISODateTime | null;
  saving: boolean;
  /** Resolves to an error message, or null when saved. */
  grant: () => Promise<string | null>;
  revoke: () => Promise<string | null>;
}

export function useAiConsent(): AiConsent {
  const { mode } = useAuth();
  const profile = useProfile();
  const update = useUpdateProfile();

  const save = async (aiConsentAt: ISODateTime | null, fallback: string): Promise<string | null> => {
    try {
      await update.mutateAsync({ aiConsentAt });
      return null;
    } catch (error) {
      logger.warn('ai consent save failed', error);
      return errorMessage(error, fallback);
    }
  };

  return {
    state: aiConsentState(mode, profile.data),
    consentAt: profile.data?.aiConsentAt ?? null,
    saving: update.isPending,
    grant: () => save(new Date().toISOString(), 'No se ha podido guardar tu permiso. Inténtalo de nuevo.'),
    revoke: () => save(null, 'No se ha podido retirar el permiso. Inténtalo de nuevo.'),
  };
}
