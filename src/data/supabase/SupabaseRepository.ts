/**
 * Repository backed by Supabase (Postgres + RLS, RPCs, Edge Functions,
 * Realtime). Each area lives in its own module; this file composes them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { todayISO } from '@/domain/dates';

import type { Repository } from '../repository';
import { createSupabaseAuth } from './auth';
import { createCtx } from './base';
import { getSupabaseClient } from './client';
import { createCoachRequester } from './coach';
import { inboxApi } from './inboxApi';
import { integrationsApi } from './integrationsApi';
import { planningApi } from './planningApi';
import { profileApi } from './profileApi';
import { subscribeRealtime } from './realtime';
import { socialApi } from './socialApi';
import { wellnessApi } from './wellnessApi';
import { workoutsApi } from './workoutsApi';

export interface SupabaseRepositoryOptions {
  client?: SupabaseClient;
  now?: () => Date;
}

export function createSupabaseRepository(options: SupabaseRepositoryOptions = {}): Repository {
  const client = options.client ?? getSupabaseClient();
  const now = options.now ?? (() => new Date());
  const ctx = createCtx(client, now);

  const data = {
    ...profileApi(ctx),
    ...workoutsApi(ctx),
    ...planningApi(ctx),
    ...wellnessApi(ctx),
    ...socialApi(ctx),
    ...inboxApi(ctx),
    ...integrationsApi(ctx),
  };

  const requestCoach = createCoachRequester({ ctx, repo: data, today: () => todayISO(now()) });

  return {
    mode: 'supabase',
    auth: createSupabaseAuth(client),
    ...data,
    requestCoach,
    subscribe: (onChange) => subscribeRealtime(ctx, onChange),
  };
}
