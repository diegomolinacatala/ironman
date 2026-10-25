import { useState } from 'react';

import { useCreateToken, useTokens } from '@/data/queries';
import type { CreatedToken, TokenScope } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

/** Max active tokens per scope (enforced server-side by create_personal_token). */
export const MAX_ACTIVE_TOKENS = 5;

export interface TokenGenerator {
  /** The freshly created token: its secret URL is shown only while this screen is open. */
  created: CreatedToken | null;
  generate: () => Promise<void>;
  generating: boolean;
  error: string | null;
  activeCount: number;
  limitReached: boolean;
}

export function useTokenGenerator(scope: TokenScope, label: string): TokenGenerator {
  const create = useCreateToken();
  const tokens = useTokens();
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeCount = (tokens.data ?? []).filter((t) => t.scope === scope && !t.revokedAt).length;

  const generate = async () => {
    setError(null);
    try {
      const token = await create.mutateAsync({ scope, label });
      haptics.success();
      setCreated(token);
    } catch (err) {
      logger.warn(`create ${scope} token failed`, err);
      haptics.warning();
      setError(errorMessage(err, 'No se pudo generar el enlace. Inténtalo de nuevo.'));
    }
  };

  return {
    created,
    generate,
    generating: create.isPending,
    error,
    activeCount,
    limitReached: activeCount >= MAX_ACTIVE_TOKENS,
  };
}
