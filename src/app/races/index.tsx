import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useRaces } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { PriorityExplainer } from '@/features/races/PriorityExplainer';
import { RaceRow } from '@/features/races/RaceRow';
import { splitRaces } from '@/features/races/raceModel';
import { errorMessage } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, SectionHeader, space } from '@/ui';

export default function RacesScreen() {
  const races = useRaces();
  const today = todayISO();
  const { upcoming, past } = splitRaces(races.data ?? [], today);
  const add = () => router.push('/races/edit');
  const edit = (id: string) => router.push(`/races/edit?id=${encodeURIComponent(id)}`);

  return (
    <Screen
      inSheet
      onRefresh={() => void races.refetch()}
      refreshing={races.isRefetching}
      footer={<Button label="Añadir carrera" icon="add" size="lg" fullWidth onPress={add} />}>
      {races.isLoading ? <Loading label="Cargando carreras…" /> : null}
      {races.error ? (
        <ErrorNotice
          message={errorMessage(races.error, 'No se han podido cargar tus carreras.')}
          onRetry={() => void races.refetch()}
        />
      ) : null}

      {!races.isLoading && !races.error && upcoming.length === 0 ? (
        <EmptyState
          icon="flag"
          title="Sin carreras a la vista"
          message="Añade tu carrera objetivo y el plan se organiza por fases (base, construcción, pico y afinamiento) hacia ella."
        />
      ) : null}

      {upcoming.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Próximas" />
          {upcoming.map((race) => (
            <RaceRow key={race.id} race={race} today={today} onPress={() => edit(race.id)} />
          ))}
        </View>
      ) : null}

      <PriorityExplainer />

      {past.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Pasadas" />
          {past.map((race) => (
            <RaceRow key={race.id} race={race} today={today} past onPress={() => edit(race.id)} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
});
