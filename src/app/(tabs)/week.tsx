import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { addDays, daysInRange, isoWeekNumber, startOfWeek, todayISO, weekRange } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { DaySection } from '@/features/week/DaySection';
import { PhaseLine } from '@/features/week/PhaseLine';
import { usePlanWeek } from '@/features/week/usePlanWeek';
import { useWeekData } from '@/features/week/useWeekData';
import { WeekSwitcher } from '@/features/week/WeekSwitcher';
import { WeekToolbar } from '@/features/week/WeekToolbar';
import { WeekTotals } from '@/features/week/WeekTotals';
import { busySummary, eventsOn, parseWeekParam, workoutsOnDay } from '@/features/week/weekModel';
import { useActionSheet } from '@/features/workouts/actionSheet';
import { partnerNameFor } from '@/features/workouts/draft';
import { useWorkoutActions } from '@/features/workouts/useWorkoutActions';
import { errorMessage } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, space } from '@/ui';

/** "Esta semana" / "Semana que viene" / "Semana 45". */
function weekOverline(weekStart: ISODate, currentWeekStart: ISODate): string {
  if (weekStart === currentWeekStart) return 'Esta semana';
  if (weekStart === addDays(currentWeekStart, 7)) return 'Semana que viene';
  return `Semana ${isoWeekNumber(weekStart)}`;
}

export default function WeekScreen() {
  const params = useLocalSearchParams<{ week?: string }>();
  const currentWeekStart = startOfWeek(todayISO());
  const weekStart = startOfWeek(parseWeekParam(params.week, currentWeekStart));
  const data = useWeekData(weekStart);
  const planner = usePlanWeek();
  const actions = useWorkoutActions();
  const sheet = useActionSheet();
  const bottomPadding = useTabBottomPadding();
  const partner = (w: Workout) => partnerNameFor(w, data.jointSessions, data.myId);

  const openActions = (w: Workout) =>
    sheet.open({
      title: w.title,
      actions: [
        ...(w.status === 'planned'
          ? [{ label: 'Mover a mañana', icon: 'move' as const, onPress: () => void actions.moveToTomorrow(w) }]
          : []),
        { label: 'Duplicar', icon: 'copy', onPress: () => void actions.duplicate(w) },
        ...(w.status === 'planned' && !w.jointSessionId && w.sport !== 'rest'
          ? [{ label: 'Invitar a un amigo', icon: 'together' as const, onPress: () => actions.invite(w) }]
          : []),
        { label: 'Borrar', icon: 'trash', destructive: true, onPress: () => void actions.remove(w) },
      ],
    });

  const days = daysInRange(weekRange(weekStart));
  const isEmpty = !data.isLoading && !data.error && data.workouts.length === 0;

  return (
    <Screen
      overline={weekOverline(weekStart, currentWeekStart)}
      title="Plan"
      onRefresh={() => void data.refresh()}
      refreshing={data.isRefreshing}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      <WeekSwitcher weekStart={weekStart} currentWeekStart={currentWeekStart} onChange={(week) => router.setParams({ week })} />
      <PhaseLine info={data.phase} />
      {data.isLoading ? <Loading label="Cargando la semana" /> : null}
      {data.error ? <ErrorNotice message={errorMessage(data.error)} onRetry={() => void data.refresh()} /> : null}
      {isEmpty ? (
        <EmptyState
          icon="week"
          title="Semana en blanco"
          message="Genera una propuesta con tu disponibilidad y tu fase, o planifícala hablando con el coach."
          action={
            <View style={styles.emptyActions}>
              <WeekToolbar weekStart={weekStart} onPlan={() => void planner.plan(weekStart, data)} planning={planner.busy} />
              <Button label="Añadir a mano" icon="add" variant="ghost" size="sm" onPress={() => router.push(`/workout/edit?date=${weekStart}`)} />
            </View>
          }
        />
      ) : null}
      {!data.isLoading && !data.error && !isEmpty ? (
        <>
          <WeekTotals summary={data.summary} targetHours={data.targetHours} />
          <WeekToolbar weekStart={weekStart} onPlan={() => void planner.plan(weekStart, data)} planning={planner.busy} />
        </>
      ) : null}
      {!data.isLoading && !data.error ? (
        <View style={styles.days}>
          {days.map((date: ISODate) => (
            <DaySection
              key={date}
              date={date}
              today={data.today}
              workouts={workoutsOnDay(data.workouts, date)}
              events={eventsOn(data.lifeEvents, date)}
              busyText={busySummary(data.busyBlocks, date)}
              partnerName={partner}
              onLongPressWorkout={openActions}
            />
          ))}
        </View>
      ) : null}
      {sheet.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  days: { gap: space.xl },
  emptyActions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.sm },
});
