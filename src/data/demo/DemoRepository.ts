/**
 * Local, AsyncStorage-backed repository seeded with two demo athletes (Diego
 * and Álex). Makes every screen usable without a backend (web preview,
 * TestFlight before Supabase is set up). Friends are simulated: they accept
 * quedadas and friend requests after ~2 s and the change is pushed through
 * `subscribe()` like realtime.
 */
import type { CoachRequest, CoachResponse } from '@/domain/types';

import type { Repository } from '../repository';
import { createDemoAuth } from './demoAuth';
import { requireMe, type DemoDeps } from './repo/common';
import { inboxDemo } from './repo/inboxDemo';
import { integrationsDemo } from './repo/integrationsDemo';
import { planningDemo } from './repo/planningDemo';
import { socialDemo } from './repo/socialDemo';
import { wellnessDemo } from './repo/wellnessDemo';
import { workoutsDemo } from './repo/workoutsDemo';
import { runRulesCoach } from './rulesCoach';
import { DemoStore, type DemoStoreOptions } from './store';

export interface DemoRepositoryOptions extends DemoStoreOptions {
  /** Delay before simulated friends react. Default 2000 ms. */
  friendDelayMs?: number;
  /** Inject a store (tests). */
  store?: DemoStore;
}

export type DemoRepository = Repository & {
  readonly store: DemoStore;
};

export function createDemoRepository(options: DemoRepositoryOptions = {}): DemoRepository {
  const store = options.store ?? new DemoStore(options);
  const deps: DemoDeps = { store, friendDelayMs: options.friendDelayMs ?? 2000 };

  const data = {
    ...planningDemo(deps),
    ...workoutsDemo(deps),
    ...wellnessDemo(deps),
    ...socialDemo(deps),
    ...inboxDemo(deps),
    ...integrationsDemo(deps),
  };

  async function requestCoach(request: CoachRequest): Promise<CoachResponse> {
    await requireMe(store);
    return runRulesCoach(data, request, { today: store.clock().today });
  }

  return {
    mode: 'demo',
    auth: createDemoAuth(store),
    store,
    ...data,
    requestCoach,
    subscribe: (onChange) => store.subscribe(onChange),
  };
}
