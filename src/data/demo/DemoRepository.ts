/**
 * Local, AsyncStorage-backed repository seeded with two demo athletes (Diego
 * and Álex). Makes every screen usable without a backend (web preview,
 * TestFlight before Supabase is set up). Friends are simulated: they accept
 * quedadas and friend requests after ~2 s and the change is pushed through
 * `subscribe()` like realtime. The AI pieces (briefing, meal photos, coach
 * memory) and the onboarding connections (Garmin, Claude) are simulated too.
 */
import type { Repository } from '../repository';
import { createDemoAuth } from './demoAuth';
import { aiDemo } from './repo/aiDemo';
import { createDemoCoach } from './repo/coachDemo';
import { DEFAULT_DEMO_DELAYS, type DemoDelays, type DemoDeps } from './repo/common';
import { inboxDemo } from './repo/inboxDemo';
import { integrationsDemo } from './repo/integrationsDemo';
import { planningDemo } from './repo/planningDemo';
import { socialDemo } from './repo/socialDemo';
import { wellnessDemo } from './repo/wellnessDemo';
import { workoutsDemo } from './repo/workoutsDemo';
import { DemoStore, type DemoStoreOptions } from './store';

export interface DemoRepositoryOptions extends DemoStoreOptions {
  /** Delay before simulated friends react. Default 2000 ms. */
  friendDelayMs?: number;
  /** Simulated latencies (AI, Garmin, claude.ai connector). Defaults: 1500 / 1200 / 6000 ms. */
  delays?: Partial<DemoDelays>;
  /** Inject a store (tests). */
  store?: DemoStore;
}

export type DemoRepository = Repository & {
  readonly store: DemoStore;
};

export function createDemoRepository(options: DemoRepositoryOptions = {}): DemoRepository {
  const store = options.store ?? new DemoStore(options);
  const deps: DemoDeps = {
    store,
    friendDelayMs: options.friendDelayMs ?? 2000,
    delays: { ...DEFAULT_DEMO_DELAYS, ...options.delays },
  };

  const data = {
    ...planningDemo(deps),
    ...workoutsDemo(deps),
    ...wellnessDemo(deps),
    ...socialDemo(deps),
    ...inboxDemo(deps),
    ...integrationsDemo(deps),
    ...aiDemo(deps),
  };

  return {
    mode: 'demo',
    auth: createDemoAuth(store),
    store,
    ...data,
    requestCoach: createDemoCoach(deps, data),
    subscribe: (onChange) => store.subscribe(onChange),
  };
}
