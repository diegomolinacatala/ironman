import { useState } from 'react';

import { useAuth } from '@/data/context';
import { useBriefing, useGenerateBriefing, useIntegrations, useProfile } from '@/data/queries';
import type { Briefing, ISODate, IntegrationStatus, WatchBrand } from '@/domain/types';
import { watchBrandOf } from '@/features/settings/watchBrand';
import { useHealthIntegration, type HealthIntegration } from '@/integrations/hooks';
import { logger } from '@/lib/logger';

import { briefingCardState, briefingSteps, watchState, type BriefingCardState, type WatchState } from './briefingModel';

/** Days of Apple Salud read right before a COROS athlete's briefing (last night and today). */
const QUICK_HEALTH_SYNC_DAYS = 2;

export interface BriefingController {
  state: BriefingCardState;
  briefing: Briefing | null;
  /** The athlete's watch (Garmin until one is chosen). */
  brand: WatchBrand;
  watch: WatchState | 'loading';
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
  /** Prepare the briefing even though the watch is not connected. */
  skipWatch: () => void;
  refetch: () => Promise<void>;
}

interface WatchInputs {
  brand: WatchBrand;
  settled: boolean;
  profileLoading: boolean;
  integrations: { data: readonly IntegrationStatus[] | undefined; isLoading: boolean };
  health: Pick<HealthIntegration, 'loaded' | 'enabled'>;
}

/** Garmin: the server-side key; COROS: Apple Salud on this iPhone ('loading' until both are known). */
function resolveWatch({ brand, settled, profileLoading, integrations, health }: WatchInputs): WatchState | 'loading' {
  if (!settled || profileLoading) return 'loading';
  if (brand === 'coros') return health.loaded ? watchState('coros', undefined, health.enabled) : 'loading';
  return integrations.isLoading ? 'loading' : watchState('garmin', integrations.data, false);
}

/** COROS has no server-side sync: last night is read from Apple Salud right before the briefing is written. */
function useCorosPreSync(brand: WatchBrand, health: HealthIntegration) {
  const [reading, setReading] = useState(false);
  const { available, enabled, syncNow } = health;
  const run = async (): Promise<void> => {
    if (brand !== 'coros' || !available || !enabled) return;
    setReading(true);
    await syncNow({ days: QUICK_HEALTH_SYNC_DAYS }).catch((error: unknown) => logger.warn('briefing: quick health sync failed', error));
    setReading(false);
  };
  return { reading, run };
}

/** Shared state of the "Informe de hoy" (Hoy card and /briefing screen). */
export function useBriefingController(date: ISODate): BriefingController {
  const { session } = useAuth();
  const query = useBriefing(date);
  const integrations = useIntegrations();
  const profile = useProfile();
  const health = useHealthIntegration();
  const mutation = useGenerateBriefing();
  const [skipped, setSkipped] = useState(false);
  const brand = watchBrandOf(profile.data);
  const preSync = useCorosPreSync(brand, health);

  const settled = session != null && query.isFetched && integrations.isFetched;
  const watch = resolveWatch({ brand, settled, profileLoading: profile.isLoading, integrations, health });
  const generating = mutation.isPending || preSync.reading;
  const briefing = query.data ?? null;
  const state = briefingCardState({
    briefing,
    briefingLoading: !settled || query.isLoading,
    briefingError: query.error,
    generating,
    generateError: mutation.error,
    watch,
    // If we cannot tell whether Garmin is connected, or COROS cannot be (no Apple Salud here), don't nag.
    skipWatch: skipped || (brand === 'coros' ? !health.available : integrations.error != null),
  });

  const generate = async (refresh = false): Promise<Briefing | null> => {
    await preSync.run();
    return mutation.mutateAsync({ date, refresh }).catch((error: unknown) => {
      logger.warn('briefing: generation failed', error);
      return null;
    });
  };

  return {
    state,
    briefing,
    brand,
    watch,
    settled,
    steps: briefingSteps(brand, watch === 'connected'),
    error: mutation.error ?? query.error ?? null,
    generating,
    generate,
    retry: () => (mutation.error ? void generate() : void query.refetch()),
    skipWatch: () => setSkipped(true),
    refetch: async () => {
      await Promise.all([query.refetch(), integrations.refetch()]);
    },
  };
}
