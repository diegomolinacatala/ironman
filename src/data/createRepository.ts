/**
 * Picks the repository implementation once per app run: Supabase when the
 * backend env vars are set (and demo mode is not forced), otherwise the local
 * demo repository.
 */
import { isBackendConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

import { createDemoRepository } from './demo/DemoRepository';
import type { Repository } from './repository';
import { createSupabaseRepository } from './supabase/SupabaseRepository';

let instance: Repository | null = null;

export function createRepository(): Repository {
  if (instance) return instance;
  instance = isBackendConfigured ? createSupabaseRepository() : createDemoRepository();
  logger.info(`repository mode: ${instance.mode}`);
  return instance;
}
