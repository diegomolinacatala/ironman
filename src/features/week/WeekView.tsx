import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { addDays, daysInRange, isoWeekNumber, startOfWeek, todayISO, weekRange } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { partnerNameFor } from '@/features/workouts/draft';
import { errorMessage } from '@/lib/logger';
import { EmptyState, ErrorNotice, Loading, Screen, space } from '@/ui';

import { DaySection } from './DaySection';
import { PhaseLine } from './PhaseLine';
import { PlanViewSwitch } from './PlanViewSwitch';
import { usePlanWeek } from './usePlanWeek';
import { useWeekData, type WeekData } from './useWeekData';
import { useWorkoutMenu } from './useWorkoutMenu';
import { WeekSwitcher } from './WeekSwitcher';
import { WeekToolbar } from './WeekToolbar';
import { WeekTotals } from './WeekTotals';
import { busySummary, eventsOn, parseWeekParam, workoutsOnDay } from './weekModel';

/** "Esta semana" / "Semana que viene" / "Semana 45". */
function weekOverline(weekStart: ISODate, currentWeekStart: ISODate): string {
  if (weekStart === currentWeekStart) return 'Esta semana';
  if (weekStart === addDays(currentWeekStart, 7)) return 'Semana que viene';
  return `Semana ${isoWeekNumber(weekStart)}`;
}

const openGeneral = () => router.setParams({ view: 'general' });

export interface WeekViewProps {
  /** Raw `?week=` param (any Monday-ish date; invalid → this week). */
  weekParam: unknown;
}

/** Plan → Semana: switcher, phase, totals, planning tools and the 7 days. */
export function WeekView({ weekParam }: WeekViewProps) {
  const currentWeekStart = startOfWeek(todayISO());
  const weekStart = startOfWeek(parseWeekParam(weekParam, currentWeekStart));
  const data = useWeekData(weekStart);
  const planner = usePlanWeek();
  const menu = useWorkoutMenu();
  const bottomPadding = useTabBottomPadding();
  const days = daysInRange(weekRange(weekStart));
  const ready = !data.isLoading && !data.error;
  const isEmpty = ready && data.workouts.length === 0;
  const toolbar = (
    <WeekToolbar
      weekStart={weekStart}
      defaultDate={days.includes(data.today) ? data.today : weekStart}
      onPlan={() => void planner.plan(weekStart, data)}
      planning={planner.busy}
    />
  );

  return (
    <Screen
      overline={weekOverline(weekStart, currentWeekStart)}
      title="Plan"
      onRefresh={() => void data.refresh()}
      refreshing={data.isRefreshing}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      <PlanViewSwitch value="week" />
      <WeekSwitcher weekStart={weekStart} currentWeekStart={currentWeekStart} onChange={(week) => router.setParams({ week })} />
      <PhaseLine info={data.phase} plan={data.weekPlan} onPress={openGeneral} />
      {data.isLoading ? <Loading label="Cargando la semana" /> : null}
      {data.error ? <ErrorNotice message={errorMessage(data.error)} onRetry={() => void data.refresh()} /> : null}
      {isEmpty ? (
        <EmptyState
          icon="week"
          title="Semana en blanco"
          message="Genera una propuesta con tu disponibilidad y tu fase, o planifícala hablando con el coach."
          action={<View style={styles.emptyActions}>{toolbar}</View>}
        />
      ) : null}
      {ready && !isEmpty ? (
        <>
          <WeekTotals summary={data.summary} targetHours={data.targetHours} />
          {toolbar}
        </>
      ) : null}
      {ready ? <WeekDays days={days} data={data} onLongPressWorkout={menu.open} /> : null}
      {menu.element}
    </Screen>
  );
}

function WeekDays({ days, data, onLongPressWorkout }: { days: ISODate[]; data: WeekData; onLongPressWorkout: (w: Workout) => void }) {
  const partner = (w: Workout) => partnerNameFor(w, data.jointSessions, data.myId);
  return (
    <View style={styles.days}>
      {days.map((date) => (
        <DaySection
          key={date}
          date={date}
          today={data.today}
          workouts={workoutsOnDay(data.workouts, date)}
          events={eventsOn(data.lifeEvents, date)}
          busyText={busySummary(data.busyBlocks, date)}
          partnerName={partner}
          onLongPressWorkout={onLongPressWorkout}
          thresholds={data.profile?.thresholds}
          raceDistance={data.phase?.targetRace?.distance ?? null}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  days: { gap: space.xl },
  emptyActions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.sm },
});
