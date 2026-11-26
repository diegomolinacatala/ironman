/**
 * Progreso — form (PMC, open) and folded sections: volume & compliance, recovery, nutrition,
 * races. Each one opens on demand and is remembered on the device. On top, only when easy
 * sessions keep coming out harder than planned, a quiet suggestion to review the zones.
 */
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { isoWeekNumber, todayISO } from '@/domain/dates';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { NutritionSummaryCard } from '@/features/nutrition/NutritionSummaryCard';
import { ComplianceCard } from '@/features/progress/ComplianceCard';
import { formFoldSummary, nutritionFoldSummary, recoveryFoldSummary, volumeFoldSummary } from '@/features/progress/foldSummaries';
import { PmcCard } from '@/features/progress/PmcCard';
import { RecoveryCard } from '@/features/progress/RecoveryCard';
import { useProgressData } from '@/features/progress/useProgressData';
import { VolumeCard } from '@/features/progress/VolumeCard';
import { ZoneReviewCard } from '@/features/progress/ZoneReviewCard';
import { useZoneReviewSnooze } from '@/features/progress/zoneReviewSnooze';
import { RaceCountdownCard } from '@/features/races/RaceCountdownCard';
import { phaseName } from '@/features/races/raceModel';
import { Button, Disclosure, ErrorNotice, Loading, Screen, space } from '@/ui';

export default function ProgressScreen() {
  const today = todayISO();
  const data = useProgressData(today);
  const overline = data.phase
    ? `Semana ${isoWeekNumber(today)} · ${phaseName(data.phase.phase)}`
    : `Semana ${isoWeekNumber(today)}`;
  const bottomPadding = useTabBottomPadding();
  const zoneSnooze = useZoneReviewSnooze(today);
  const zoneTrend = zoneSnooze.loaded && !zoneSnooze.snoozed ? data.zoneTrend : null;

  return (
    <Screen
      title="Progreso"
      overline={overline}
      onRefresh={data.refetch}
      refreshing={data.isRefetching}
      contentStyle={[styles.content, bottomPadding != null ? { paddingBottom: bottomPadding } : null]}>
      {data.error ? <ErrorNotice message={data.error} onRetry={data.refetch} /> : null}
      {data.isLoading ? <Loading label="Calculando tu forma…" /> : null}

      {zoneTrend ? (
        <ZoneReviewCard trend={zoneTrend} onReview={() => router.push('/settings/profile')} onDismiss={zoneSnooze.snooze} />
      ) : null}

      {data.pmc ? (
        <Disclosure variant="plain" title="Tu forma" summary={formFoldSummary(data.pmc)} defaultOpen storageKey="progress.form">
          <PmcCard series={data.pmc} />
        </Disclosure>
      ) : null}

      {data.volume.length > 0 ? (
        <Disclosure variant="plain" title="Volumen y cumplimiento" summary={volumeFoldSummary(data.volume)} storageKey="progress.volume">
          <VolumeCard weeks={data.volume} />
          <ComplianceCard weeks={data.volume.slice(-5)} />
        </Disclosure>
      ) : null}

      {!data.isLoading && !data.error ? (
        <>
          <Disclosure variant="plain" title="Recuperación" summary={recoveryFoldSummary(data.recovery)} storageKey="progress.recovery">
            <RecoveryCard series={data.recovery} />
            <Button label="Conexiones" icon="plug" variant="ghost" size="sm" onPress={() => router.push('/settings/integrations')} />
          </Disclosure>

          <Disclosure variant="plain" title="Nutrición" summary={nutritionFoldSummary(data.nutrition)} storageKey="progress.nutrition">
            <NutritionSummaryCard totals={data.nutrition?.totals ?? null} entries={data.nutrition?.entries ?? 0} />
          </Disclosure>
        </>
      ) : null}

      {!data.isLoading ? (
        <Disclosure variant="plain" title="Carreras" summary={data.race ? data.race.name : 'Añade tu próxima carrera'} storageKey="progress.races">
          <RaceCountdownCard race={data.race} phase={data.phase} today={today} />
        </Disclosure>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
});
