import { useEffect, useState } from 'react';

import { rememberAsked } from '@/domain/rideCompanion';
import { readJson, writeJson } from '@/lib/storage';

/** Workouts already asked «¿Sales con alguien?» on this device. */
export const RIDE_ASKED_KEY = 'rti.rideAsk.v1';

let cache: string[] | null = null;
const listeners = new Set<(ids: string[]) => void>();

/** Remembers that `workoutId` was asked (friend chosen, «Solo», or prefilled from the Wednesday question). */
export async function markRideAsked(workoutId: string): Promise<void> {
  const current = cache ?? (await readJson<string[]>(RIDE_ASKED_KEY, []));
  cache = rememberAsked(Array.isArray(current) ? current : [], workoutId);
  listeners.forEach((l) => l(cache ?? []));
  await writeJson(RIDE_ASKED_KEY, cache);
}

/** The asked ids (null while loading). */
export function useRideAsked(): string[] | null {
  const [ids, setIds] = useState<string[] | null>(cache);
  useEffect(() => {
    let live = true;
    listeners.add(setIds);
    if (cache === null) {
      void readJson<string[]>(RIDE_ASKED_KEY, []).then((stored) => {
        cache = cache ?? (Array.isArray(stored) ? stored : []);
        if (live) setIds(cache);
      });
    }
    return () => {
      live = false;
      listeners.delete(setIds);
    };
  }, []);
  return ids;
}

/** Tests only. */
export function resetRideAskedCache(): void {
  cache = null;
}
