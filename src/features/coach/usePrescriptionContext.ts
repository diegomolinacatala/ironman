import { useMemo } from 'react';

import { useProfile, useRaces } from '@/data/queries';
import { todayISO } from '@/domain/dates';

import { prescriptionContext, type PrescriptionContext } from './prescriptionContext';

/** Thresholds (profile) and target race distance for concrete session targets. */
export function usePrescriptionContext(): PrescriptionContext {
  const thresholds = useProfile().data?.thresholds ?? null;
  const races = useRaces().data;
  return useMemo(() => prescriptionContext(thresholds, races, todayISO()), [thresholds, races]);
}
