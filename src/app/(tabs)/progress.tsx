import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { isoWeekNumber, todayISO } from '@/domain/dates';
import { ComplianceCard } from '@/features/progress/ComplianceCard';
import { PmcCard } from '@/features/progress/PmcCard';
import { RecoveryCard } from '@/features/progress/RecoveryCard';
import { useProgressData } from '@/features/progress/useProgressData';
import { VolumeCard } from '@/features/progress/VolumeCard';
import { RaceCountdownCard } from '@/features/races/RaceCountdownCard';
import { phaseName } from '@/features/races/raceModel';
import { Card, Divider, ErrorNotice, IconButton, ListRow, Loading, Screen, SectionHeader, space } from '@/ui';

function Links() {
  return (
    <Card variant="flat" padding="sm">
      <ListRow
        icon="flag"
        title="Carreras"
        subtitle="Calendario de carreras y prioridades A/B/C"
        onPress={() => router.push('/races')}
      />
      <Divider inset={50} />
      <ListRow
        icon="food"
        title="Nutrición"
        subtitle="Lo que comes y cómo alimentarte en las sesiones clave"
        onPress={() => router.push('/nutrition')}
      />
      <Divider inset={50} />
      <ListRow
        icon="coach"
        title="Coach"
        subtitle="Pide que ajuste tu semana según tu frescura"
        onPress={() => router.push('/coach')}
      />
    </Card>
  );
}

export default function ProgressScreen() {
  const today = todayISO();
  const data = useProgressData(today);
  const overline = data.phase
    ? `Semana ${isoWeekNumber(today)} · ${phaseName(data.phase.phase)}`
    : `Semana ${isoWeekNumber(today)}`;

  return (
    <Screen
      title="Progreso"
      overline={overline}
      onRefresh={data.refetch}
      refreshing={data.isRefetching}
      headerRight={<IconButton icon="coach" variant="filled" accessibilityLabel="Abrir el coach" onPress={() => router.push('/coach')} />}>
      {data.error ? <ErrorNotice message={data.error} onRetry={data.refetch} /> : null}
      {data.isLoading ? <Loading label="Calculando tu forma…" /> : null}
      {data.pmc ? <PmcCard series={data.pmc} /> : null}

      <View style={styles.section}>
        <SectionHeader title="Próxima carrera" action={{ label: 'Carreras', onPress: () => router.push('/races') }} />
        {!data.isLoading ? <RaceCountdownCard race={data.race} phase={data.phase} today={today} /> : null}
      </View>

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

      <Links />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md, marginTop: space.sm },
});
