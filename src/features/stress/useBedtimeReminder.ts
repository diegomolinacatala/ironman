import { useMemo } from 'react';

import type { StressSleepSignal } from '@/domain/stressSleep';
import type { ISODate } from '@/domain/types';
import type { BedtimeReminder } from '@/integrations/notifications/schedule';

import { useStressSleep } from './useStressSleep';

/** What the bedtime reminder of `signal` needs (null = no reminder today). */
export function bedtimeReminderOf(signal: StressSleepSignal | null): BedtimeReminder | null {
  return signal ? { date: signal.date, usualBedtimeMin: signal.usualBedtimeMin, headline: signal.headline } : null;
}

/** Today's bedtime reminder for the local schedule, stable across renders while it does not change. */
export function useBedtimeReminder(today: ISODate): BedtimeReminder | null {
  const reminder = bedtimeReminderOf(useStressSleep(today));
  const date = reminder?.date ?? null;
  const usual = reminder?.usualBedtimeMin ?? null;
  const headline = reminder?.headline ?? null;
  return useMemo(() => (date && usual !== null && headline ? { date, usualBedtimeMin: usual, headline } : null), [date, usual, headline]);
}
