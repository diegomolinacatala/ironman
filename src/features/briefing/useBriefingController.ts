import { useState } from 'react';

import { useAuth } from '@/data/context';
import { useBriefing, useGenerateBriefing, useIntegrations } from '@/data/queries';
import type { Briefing, ISODate } from '@/domain/types';
import { logger } from '@/lib/logger';

import { briefingCardState, briefingSteps, garminState, type BriefingCardState, type GarminState } from './briefingModel';

export interface BriefingController {
  state: BriefingCardState;
  briefing: Briefing | null;
  garmin: GarminState | 'loading';
  /**
   * True once signed in AND both the briefing and the integrations queries have fetched at least
   * once. Before that (cold start from the widget/notification: queries are disabled until the
   * session is restored) nothing may be decided: the state stays 'loading'.
   */
  settled: boolean;
  /** Progress copy shown while generating. */
  steps: readonly string[];
  /** Error of the last load or generation (null when fine). */
  error: unknown;
  generating: boolean;
  /** Generates (or regenerates with `refresh`) the briefing; resolves null on failure (error is kept). */
  generate: (refresh?: boolean) => Promise<Briefing | null>;
  /** Retries whatever failed (load or generation). */
  retry: () => void;
  /** Prepare the briefing even though Garmin is not connected. */
  skipGarmin: () => void;
  refetch: () => Promise<void>;
}

/** Shared state of the "Informe de hoy" (Hoy card and /briefing screen). */
export function useBriefingController(date: ISODate): BriefingController {
  const { session } = useAuth();
  const query = useBriefing(date);
  const integrations = useIntegrations();
  const mutation = useGenerateBriefing();
  const [skipped, setSkipped] = useState(false);

  const settled = session != null && query.isFetched && integrations.isFetched;
  const garmin: GarminState | 'loading' =
    !settled || integrations.isLoading ? 'loading' : garminState(integrations.data);
  const briefing = query.data ?? null;
  const state = briefingCardState({
    briefing,
    briefingLoading: !settled || query.isLoading,
    briefingError: query.error,
    generating: mutation.isPending,
    generateError: mutation.error,
    garmin,
    // If we cannot tell whether Garmin is connected, don't nag: let the athlete prepare it.
    skipGarmin: skipped || integrations.error != null,
  });

  const generate = async (refresh = false): Promise<Briefing | null> => {
    try {
      return await mutation.mutateAsync({ date, refresh });
    } catch (error) {
      logger.warn('briefing: generation failed', error);
      return null;
    }
  };

  return {
    state,
    briefing,
    garmin,
    settled,
    steps: briefingSteps(garmin !== 'missing' && garmin !== 'expired'),
    error: mutation.error ?? query.error ?? null,
    generating: mutation.isPending,
    generate,
    retry: () => {
      if (mutation.error) void generate();
      else void query.refetch();
    },
    skipGarmin: () => setSkipped(true),
    refetch: async () => {
      await Promise.all([query.refetch(), integrations.refetch()]);
    },
  };
}
