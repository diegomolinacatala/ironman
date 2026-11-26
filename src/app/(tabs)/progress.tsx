/**
 * Progreso — this week's activity, a threshold suggestion when there is one, and folded sections:
 * form, volume & compliance, recovery, nutrition, races. Each fold shows its figure and is remembered
 * on the device. Only when easy sessions keep coming out harder than planned, a quiet suggestion to
 * review the zones.
 */
import { router } from 'expo-router';

import { formatWeekRange, startOfWeek, todayISO } from '@/domain/dates';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { NutritionSummaryCard } from '@/features/nutrition/NutritionSummaryCard';
import { ComplianceCard } from '@/features/progress/ComplianceCard';
import { formFoldSummary, nutritionFoldSummary, recoveryFoldSummary, volumeFoldSummary } from '@/features/progress/foldSummaries';
import { PmcCard } from '@/features/progress/PmcCard';
import { RecoveryCard } from '@/features/progress/RecoveryCard';
import { useProgressData } from '@/features/progress/useProgressData';
import { VolumeCard } from '@/features/progress/VolumeCard';
import { WeekActivity } from '@/features/progress/WeekActivity';
import { ZoneReviewCard } from '@/features/progress/ZoneReviewCard';
import { useZoneReviewSnooze } from '@/features/progress/zoneReviewSnooze';
import { RaceCountdownCard } from '@/features/races/RaceCountdownCard';
import { phaseName } from '@/features/races/raceModel';
import { ThresholdSuggestions } from '@/features/thresholds/ThresholdSuggestions';
import { Disclosure, ErrorNotice, GroupedList, Loading, Screen } from '@/ui';

export default function ProgressScreen() {
  const today = todayISO();
  const data = useProgressData(today);
  const range = formatWeekRange(startOfWeek(today));
  const overline = data.phase ? `${range} · ${phaseName(data.phase.phase)}` : range;
  const week = data.volume.find((item) => item.isCurrent);
  const bottomPadding = useTabBottomPadding();
  const zoneSnooze = useZoneReviewSnooze(today);
  const zoneTrend = zoneSnooze.loaded && !zoneSnooze.snoozed ? data.zoneTrend : null;

  return (
    <Screen
      title="Progreso"
      overline={overline}
      onRefresh={data.refetch}
      refreshing={data.isRefetching}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      {data.error ? <ErrorNotice message={data.error} onRetry={data.refetch} /> : null}
      {data.isLoading ? <Loading label="Cargando tu actividad…" /> : null}
      {week ? <WeekActivity week={week} /> : null}
      {/* "¿Actualizo tu umbral?" when the last 8 weeks say it moved (never applied without «Actualizar»). */}
      <ThresholdSuggestions today={today} />
      {zoneTrend ? (
        <ZoneReviewCard trend={zoneTrend} onReview={() => router.push('/settings/profile')} onDismiss={zoneSnooze.snooze} />
      ) : null}

      <GroupedList>
      {data.pmc ? (
        <Disclosure variant="plain" title="Tu forma" icon="progress" summary={formFoldSummary(data.pmc)} storageKey="progress.form">
          <PmcCard series={data.pmc} />
        </Disclosure>
      ) : null}

      {data.volume.length > 0 ? (
        <Disclosure variant="plain" title="Volumen y cumplimiento" icon="week" summary={volumeFoldSummary(data.volume)} storageKey="progress.volume">
          <VolumeCard weeks={data.volume} />
          <ComplianceCard weeks={data.volume.slice(-5)} />
        </Disclosure>
      ) : null}

      {data.recovery && <Disclosure variant="plain" title="Recuperación" icon="heartOutline" summary={recoveryFoldSummary(data.recovery)} storageKey="progress.recovery">
        <RecoveryCard series={data.recovery} />
      </Disclosure>}

      {data.nutrition && <Disclosure variant="plain" title="Nutrición" icon="food" summary={nutritionFoldSummary(data.nutrition)} storageKey="progress.nutrition">
        <NutritionSummaryCard totals={data.nutrition.totals} entries={data.nutrition.entries} />
      </Disclosure>}

      {data.racesLoaded ? (
        <Disclosure variant="plain" title="Carreras" icon="flag" summary={data.race ? data.race.name : 'Añade tu próxima carrera'} storageKey="progress.races">
          <RaceCountdownCard race={data.race} phase={data.phase} today={today} />
        </Disclosure>
      ) : null}
      </GroupedList>
    </Screen>
  );
}

