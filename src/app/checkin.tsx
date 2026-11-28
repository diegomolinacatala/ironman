import { useLocalSearchParams } from 'expo-router';

import { addDays, todayISO } from '@/domain/dates';
import { journalHabitsOf } from '@/domain/habitCatalog';
import { illnessSignal } from '@/domain/illness';
import { useCheckins, useMetrics, useProfile } from '@/data/queries';
import { checkinToForm } from '@/features/checkin/checkinForm';
import { CheckinEditor } from '@/features/checkin/CheckinEditor';
import { errorMessage } from '@/lib/logger';
import { ErrorNotice, Loading, Screen } from '@/ui';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Last night plus the 28 nights of the illness baseline (domain/illness.ts). */
const WELLNESS_DAYS = 29;

export default function CheckinScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const today = todayISO();
  const date = typeof params.date === 'string' && DATE_RE.test(params.date) ? params.date : today;
  const checkins = useCheckins({ from: date, to: date });
  const metrics = useMetrics({ from: addDays(date, -(WELLNESS_DAYS - 1)), to: date });
  const profile = useProfile();

  // Wait for metrics and the profile too: the form seeds "Horas de sueño" and the questions only once, on mount.
  if (checkins.isLoading || metrics.isLoading || profile.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando" />
      </Screen>
    );
  }
  // A failed background refetch (e.g. the one after saving) keeps the data: only a first-load failure replaces the editor.
  if (checkins.error && !checkins.data) {
    return (
      <Screen inSheet>
        <ErrorNotice message={errorMessage(checkins.error)} onRetry={() => void checkins.refetch()} />
      </Screen>
    );
  }
  const existing = (checkins.data ?? []).find((c) => c.date === date) ?? null;
  const allMetrics = metrics.data ?? [];
  const todayMetrics = allMetrics.find((m) => m.date === date) ?? null;
  // Breathing or pulse above the athlete's baseline last night: one extra question at the top.
  const illness = illnessSignal(allMetrics, date);
  const initial = checkinToForm(date, existing, todayMetrics?.sleepHours ?? null, journalHabitsOf(profile.data), illness.level !== 'none');
  // Keyed by date only: saving refetches the day and `existing` appears, which must not remount the editor.
  return (
    <CheckinEditor
      key={date}
      initial={initial}
      date={date}
      today={today}
      metrics={allMetrics}
      todayMetrics={todayMetrics}
      illness={illness}
    />
  );
}
