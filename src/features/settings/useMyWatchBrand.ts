import { useProfile } from '@/data/queries';
import type { WatchBrand } from '@/domain/types';

import { watchBrandOf } from './watchBrand';

/** The signed-in athlete's watch, for brand-aware copy (Garmin until one is chosen). */
export function useMyWatchBrand(): WatchBrand {
  return watchBrandOf(useProfile().data);
}
