import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { daysInRange, formatDayMedium, startOfWeek, todayISO, weekRange } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import { useTabBottomPadding } from '@/features/accessory/useTabBottomPadding';
import { WeatherPlaceHint } from '@/features/weather/WeatherPlaceHint';
import { needsPlaceHint } from '@/features/weather/weatherModel';
import { partnerNameFor } from '@/features/workouts/draft';
import { errorMessage } from '@/lib/logger';
import { Button, Disclosure, EmptyState, ErrorNotice, Loading, Screen, space } from '@/ui';

import { DaySection } from './DaySection';
import { weekSummaryLine } from './daySummary';
import { PhaseLine } from './PhaseLine';
import { PlanViewSwitch } from './PlanViewSwitch';
import { usePlanWeek } from './usePlanWeek';
import { useWeekData, type WeekData } from './useWeekData';
import { useWorkoutMenu } from './useWorkoutMenu';
import { WeekSwitcher } from './WeekSwitcher';
import { WeekToolbar } from './WeekToolbar';
import { WeekTotals } from './WeekTotals';
import { busySummary, eventsOn, parseWeekParam, workoutsOnDay } from './weekModel';

const openGeneral = () => router.setParams({ view: 'general' });

export function WeekView({ weekParam }: { weekParam: unknown }) {
  const currentWeekStart = startOfWeek(todayISO());
  const weekStart = startOfWeek(parseWeekParam(weekParam, currentWeekStart));
  const data = useWeekData(weekStart);
  const planner = usePlanWeek();
  const menu = useWorkoutMenu();
  const bottomPadding = useTabBottomPadding();
  const range = weekRange(weekStart);
  const days = daysInRange(range);
  const ready = !data.isLoading && !data.error;
  const empty = data.workouts.length === 0;
  const planButton = range.to >= data.today ? (
    <Button
      label="Planificar semana"
      icon="sparkles"
      variant={empty ? 'primary' : 'secondary'}
      onPress={() => void planner.plan(weekStart, data)}
      loading={planner.busy}
      accessibilityHint="Revisa una propuesta con entrenos para tus huecos libres"
    />
  ) : null;
  const agenda = <WeekDays days={days} data={data} onLongPressWorkout={menu.open} />;

  return (
    <Screen
      title="Plan"
      headerRight={ready ? <WeekToolbar defaultDate={days.includes(data.today) ? data.today : weekStart} /> : null}
      onRefresh={() => void data.refresh()}
      refreshing={data.isRefreshing}
      contentStyle={bottomPadding != null ? { paddingBottom: bottomPadding } : undefined}>
      <PlanViewSwitch value="week" />
      <WeekSwitcher weekStart={weekStart} currentWeekStart={currentWeekStart} onChange={(week) => router.setParams({ week })} />
      {data.isLoading ? <Loading label="Cargando la semana" /> : null}
      {data.error ? <ErrorNotice message={errorMessage(data.error)} onRetry={() => void data.refresh()} /> : null}
      {ready && empty ? (
        <>
          <EmptyState
            icon="week"
            title="Semana en blanco"
            message={planButton ? 'Prepara una propuesta que encaje en tu calendario.' : 'No hay entrenos registrados esta semana.'}
            action={planButton}
          />
          <PhaseLine info={data.phase} plan={data.weekPlan} onPress={openGeneral} />
        </>
      ) : null}
      {ready && (empty && !data.lifeEvents.length && !data.busyBlocks.length ? (
        <Disclosure title="Ver días de la semana" icon="week">{agenda}</Disclosure>
      ) : agenda)}
      {ready && !empty && needsPlaceHint(data.profile, data.workouts, data.today) ? <WeatherPlaceHint /> : null}
      {ready && !empty ? (
        <Disclosure title="Resumen de la semana" summary={weekSummaryLine(data.summary)} icon="progress" storageKey="plan.summary">
          <PhaseLine info={data.phase} plan={data.weekPlan} onPress={openGeneral} />
          <WeekTotals summary={data.summary} targetHours={data.targetHours} embedded />
          {planButton}
        </Disclosure>
      ) : null}
      {menu.element}
    </Screen>
  );
}

function WeekDays({ days, data, onLongPressWorkout }: { days: ISODate[]; data: WeekData; onLongPressWorkout: (w: Workout) => void }) {
  const currentWeek = days.includes(data.today);
  const past = currentWeek ? days.filter((date) => date < data.today) : [];
  const visible = currentWeek ? days.filter((date) => date >= data.today) : days;
  const partner = (w: Workout) => partnerNameFor(w, data.jointSessions, data.myId);
  const renderDay = (date: ISODate) => (
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
  );

  return (
    <View style={styles.days}>
      {visible.map(renderDay)}
      {past.length ? (
        <Disclosure title="Días anteriores" summary={past.length === 1 ? formatDayMedium(past[0]!) : `${formatDayMedium(past[0]!)} – ${formatDayMedium(past[past.length - 1]!)}`}>
          {past.map(renderDay)}
        </Disclosure>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ days: { gap: space.sm } });
