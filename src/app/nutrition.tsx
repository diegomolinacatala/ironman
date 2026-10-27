import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCreateNutrition, useDeleteNutrition, useNutrition, useWorkouts } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { ISODate, NutritionDraft, NutritionLog, UUID } from '@/domain/types';
import { confirmAction } from '@/features/coach/confirm';
import { DaySwitcher } from '@/features/nutrition/DaySwitcher';
import { DayTotalsBar } from '@/features/nutrition/DayTotalsBar';
import { FuelingTips } from '@/features/nutrition/FuelingTips';
import { MealGroup } from '@/features/nutrition/MealGroup';
import { NutritionEntryForm } from '@/features/nutrition/NutritionEntryForm';
import { dayTotals, fuelingSessions, groupBySlot } from '@/features/nutrition/nutritionModel';
import { FormScreen } from '@/features/workouts/FormScreen';
import { deleteMealPhoto } from '@/integrations/camera/mealPhoto';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, ErrorNotice, Icon, Loading, SectionHeader, Text, space, useTheme } from '@/ui';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function CoachNote() {
  const { colors } = useTheme();
  const ask = () =>
    router.push(`/talk?message=${encodeURIComponent('¿Qué como antes del fondo largo de esta semana?')}`);
  return (
    <Card variant="tinted" tint={colors.surfaceAlt} padding="md" onPress={ask} accessibilityLabel="Tu coach lee este registro. Preguntarle qué comer antes del fondo largo.">
      <View style={styles.noteRow}>
        <Icon name="coach" size={18} color={colors.text} />
        <View style={styles.flex}>
          <Text variant="callout">Tu coach lee este registro para ajustar tus sesiones y sus consejos de comida.</Text>
          <Text variant="caption" color="accentInk">
            Pregúntale qué comer antes del fondo largo
          </Text>
        </View>
      </View>
    </Card>
  );
}

export default function NutritionScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const today = todayISO();
  const [date, setDate] = useState<ISODate>(params.date && DATE_RE.test(params.date) ? params.date : today);
  const [deletingId, setDeletingId] = useState<UUID | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const range = { from: date, to: date };
  const logs = useNutrition(range);
  const workouts = useWorkouts(range);
  const create = useCreateNutrition();
  const remove = useDeleteNutrition();

  const changeDate = (next: ISODate) => {
    setDate(next);
    setActionError(null);
    router.setParams({ date: next });
  };

  const add = async (draft: NutritionDraft): Promise<boolean> => {
    setActionError(null);
    try {
      await create.mutateAsync(draft);
      return true;
    } catch (err) {
      logger.warn('create nutrition failed', err);
      setActionError(errorMessage(err, 'No se ha podido guardar la comida.'));
      return false;
    }
  };

  const del = async (log: NutritionLog) => {
    const ok = await confirmAction({ title: '¿Borrar esta entrada?', message: log.description, confirmLabel: 'Borrar', destructive: true });
    if (!ok) return;
    setDeletingId(log.id);
    try {
      await remove.mutateAsync(log.id);
      // The private photo goes with its entry; a leftover file is not worth an error.
      await deleteMealPhoto(log.id).catch((err: unknown) => logger.warn('delete meal photo failed', err));
    } catch (err) {
      logger.warn('delete nutrition failed', err);
      setActionError(errorMessage(err, 'No se ha podido borrar la entrada.'));
    } finally {
      setDeletingId(null);
    }
  };

  const groups = groupBySlot(logs.data ?? []);
  const sessions = fuelingSessions(workouts.data ?? [], date);

  return (
    <FormScreen inSheet onRefresh={() => void logs.refetch()} refreshing={logs.isRefetching}>
      <DaySwitcher date={date} today={today} onChange={changeDate} />

      <View style={styles.section}>
        <SectionHeader title="Combustible para tus sesiones" />
        {workouts.isLoading ? <Loading /> : <FuelingTips workouts={sessions} />}
        {workouts.error ? <ErrorNotice message={errorMessage(workouts.error)} onRetry={() => void workouts.refetch()} /> : null}
      </View>

      <View style={styles.section}>
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <SectionHeader title="Lo que has comido" />
          </View>
          <Button
            label="+ Foto"
            icon="camera"
            variant="secondary"
            size="sm"
            accessibilityHint="Haz una foto de tu comida y calculo calorías y macros"
            onPress={() => router.push(date === today ? '/meal?source=camera' : `/meal?source=camera&date=${date}`)}
          />
        </View>
        <NutritionEntryForm key={date} date={date} saving={create.isPending} onSubmit={add} />
        {actionError ? <ErrorNotice message={actionError} /> : null}
        {logs.isLoading ? <Loading label="Cargando el registro…" /> : null}
        {logs.error ? (
          <ErrorNotice message={errorMessage(logs.error, 'No se ha podido cargar el registro.')} onRetry={() => void logs.refetch()} />
        ) : null}
        {!logs.isLoading && !logs.error && groups.length === 0 ? (
          <Text variant="callout" color="textMuted">
            Nada apuntado este día. Basta con una línea por comida: «pasta con atún», «gel + isotónico»…
          </Text>
        ) : null}
        <DayTotalsBar totals={dayTotals(logs.data ?? [])} />
        {groups.map((g) => (
          <MealGroup key={g.slot} group={g} deletingId={deletingId} onDelete={(log) => void del(log)} />
        ))}
      </View>

      <CoachNote />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1, gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
