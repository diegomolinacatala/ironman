/**
 * Progreso — form (PMC) → volume & compliance → recovery → nutrition → races.
 * A tab since the 2026-11 rebrand; every section has one clear way into its detail screen.
 */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { isoWeekNumber, todayISO } from '@/domain/dates';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { NutritionSummaryCard } from '@/features/nutrition/NutritionSummaryCard';
import { ComplianceCard } from '@/features/progress/ComplianceCard';
import { PmcCard } from '@/features/progress/PmcCard';
import { RecoveryCard } from '@/features/progress/RecoveryCard';
import { useProgressData } from '@/features/progress/useProgressData';
import { VolumeCard } from '@/features/progress/VolumeCard';
import { RaceCountdownCard } from '@/features/races/RaceCountdownCard';
import { phaseName } from '@/features/races/raceModel';
import { ErrorNotice, Loading, Screen, SectionHeader, space } from '@/ui';

export default function ProgressScreen() {
  const today = todayISO();
  const data = useProgressData(today);
  const overline = data.phase
    ? `Semana ${isoWeekNumber(today)} · ${phaseName(data.phase.phase)}`
    : `Semana ${isoWeekNumber(today)}`;
  const bottomPadding = useTabBottomPadding();

  return (
    <Screen
      title="Progreso"
      overline={overline}
      onRefresh={data.refetch}
      refreshing={data.isRefetching}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      {data.error ? <ErrorNotice message={data.error} onRetry={data.refetch} /> : null}
      {data.isLoading ? <Loading label="Calculando tu forma…" /> : null}

      {data.pmc ? (
        <View style={styles.section}>
          <SectionHeader title="Tu forma" />
          <PmcCard series={data.pmc} />
        </View>
      ) : null}

      {data.volume.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Volumen y cumplimiento" />
          <VolumeCard weeks={data.volume} />
          <ComplianceCard weeks={data.volume.slice(-5)} />
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader
          title="Recuperación"
          action={{ label: 'Conexiones', onPress: () => router.push('/settings/integrations') }}
        />
        <RecoveryCard series={data.recovery} />
      </View>

      <View style={styles.section}>
        <SectionHeader title="Nutrición" />
        <NutritionSummaryCard totals={data.nutrition?.totals ?? null} entries={data.nutrition?.entries ?? 0} />
      </View>

      {!data.isLoading ? (
        <View style={styles.section}>
          <SectionHeader title="Carreras" />
          <RaceCountdownCard race={data.race} phase={data.phase} today={today} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md, marginTop: space.sm },
});
