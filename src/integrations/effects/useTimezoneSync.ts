/**
 * Keeps `profiles.timezone` on the device's zone. The server works out "today"
 * (coach, briefing, ICS, Garmin, the past-date guard of plan changes) from it, and
 * it was only ever the 'Europe/Madrid' default: an athlete in the Canaries or
 * travelling got the server's day an hour (or a day) off the app's.
 */
import { useEffect, useRef } from 'react';

import { useUpdateProfile } from '@/data/queries';
import type { Profile } from '@/domain/types';
import { logger } from '@/lib/logger';

/** The device's IANA zone ("Atlantic/Canary"), or null when the runtime does not say. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 && zone.length <= 64 ? zone : null;
  } catch {
    return null;
  }
}

/** The zone to save, or null when there is nothing to change. */
export function timezoneToSync(profileZone: string | null | undefined, deviceZone: string | null): string | null {
  if (!deviceZone || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(deviceZone)) return null;
  return deviceZone === profileZone ? null : deviceZone;
}

export function useTimezoneSync(enabled: boolean, profile: Pick<Profile, 'timezone'> | null): void {
  const update = useUpdateProfile();
  const tried = useRef<string | null>(null);
  const target = enabled && profile ? timezoneToSync(profile.timezone, deviceTimeZone()) : null;
  useEffect(() => {
    // Once per zone and session: a rejected zone (the server validates it) is not retried in a loop.
    if (!target || tried.current === target) return;
    tried.current = target;
    update.mutateAsync({ timezone: target }).catch((error: unknown) => logger.warn('timezone sync failed', error));
  }, [target, update]);
}
