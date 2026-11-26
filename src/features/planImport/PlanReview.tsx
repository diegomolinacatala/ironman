import { StyleSheet, View } from 'react-native';

import { addDays, formatDayLong, formatDuration, formatWeekRange } from '@/domain/dates';
import { intensityLabel, intensityZone, sportLabel, weekdayInitial, weekdayLabel } from '@/domain/labels';
import { importToWorkouts, planImportSourceLabel, sessionsByWeek } from '@/domain/planImport';
import type { ImportedPlan, ImportedSession } from '@/domain/planImport';
import { INTENSITIES } from '@/domain/types';
import type { Intensity, ISODate, Sport, Weekday } from '@/domain/types';
import { SwitchRow } from '@/features/settings/SwitchRow';
import { Button, Card, Chip, Disclosure, ErrorNotice, Icon, IconButton, ListRow, SportBadge, Stack, Stepper, Tag, Text, TextField, space, useTheme } from '@/ui';

import type { PlanImportAction } from './planImportFlow';

const EDIT_SPORTS: Sport[] = ['swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other'];
const DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export interface PlanReviewProps {
  plan: ImportedPlan;
  start: ISODate;
  today: ISODate;
  replace: boolean;
  editing: string | null;
  error: string | null;
  dispatch: (action: PlanImportAction) => void;
}

function sessionLine(s: ImportedSession): string {
  const parts = [weekdayLabel(s.day), formatDuration(s.durationMin)];
  if (s.sport !== 'strength' && s.sport !== 'mobility') parts.push(intensityZone(s.intensity));
  return parts.join(' · ');
}

function ConfidenceNotice({ plan }: { plan: ImportedPlan }) {
  const { colors } = useTheme();
  if (plan.confidence === 'high' && plan.warnings.length === 0) return null;
  const low = plan.confidence === 'low';
  const lines = [
    low
      ? 'No lo he leído con seguridad: revisa sobre todo las sesiones marcadas antes de guardarlo.'
      : plan.confidence === 'medium'
        ? 'Revisa las sesiones marcadas: alguna duración o zona la he deducido.'
        : null,
    ...plan.warnings,
  ].filter((l): l is string => Boolean(l));
  return (
    <Card tint={low ? undefined : colors.accentSoft}>
      <View style={styles.notice}>
        <Icon name={low ? 'warning' : 'info'} size={20} color={low ? colors.warning : colors.onAccentSoft} />
        <Stack gap="xs" style={styles.flex}>
          {lines.map((line) => (
            <Text key={line} variant="callout">
              {line}
            </Text>
          ))}
        </Stack>
      </View>
    </Card>
  );
}

function SessionEditor({ session, dispatch }: { session: ImportedSession; dispatch: (a: PlanImportAction) => void }) {
  const update = (patch: Partial<Omit<ImportedSession, 'key'>>) => dispatch({ type: 'updateSession', key: session.key, patch });
  return (
    <Stack gap="md" style={styles.editor}>
      <TextField label="Sesión" value={session.title} onChangeText={(title) => update({ title })} maxLength={120} />
      <Stack gap="xs">
        <Text variant="caption" color="textMuted">Deporte</Text>
        <View style={styles.chips}>
          {EDIT_SPORTS.map((sport) => (
            <Chip key={sport} label={sportLabel(sport)} selected={session.sport === sport} onPress={() => update({ sport })} />
          ))}
        </View>
      </Stack>
      <Stack gap="xs">
        <Text variant="caption" color="textMuted">Día</Text>
        <View style={styles.chips}>
          {DAYS.map((day) => (
            <Chip key={day} label={weekdayInitial(day)} selected={session.day === day} onPress={() => update({ day })} />
          ))}
        </View>
      </Stack>
      <Stepper label="Duración" value={session.durationMin} min={5} max={720} step={5} format={formatDuration} onChange={(durationMin) => update({ durationMin })} />
      <Stack gap="xs">
        <Text variant="caption" color="textMuted">Intensidad</Text>
        <View style={styles.chips}>
          {INTENSITIES.map((intensity: Intensity) => (
            <Chip key={intensity} label={intensityLabel(intensity)} selected={session.intensity === intensity} onPress={() => update({ intensity })} />
          ))}
        </View>
      </Stack>
      {session.description ? (
        <Text variant="caption" color="textMuted">
          {session.description}
        </Text>
      ) : null}
      <View style={styles.editorActions}>
        <Button label="Quitar sesión" variant="ghost" size="sm" icon="trash" onPress={() => dispatch({ type: 'removeSession', key: session.key })} />
        <Button label="Listo" variant="secondary" size="sm" icon="check" onPress={() => dispatch({ type: 'edit', key: null })} />
      </View>
    </Stack>
  );
}

function SessionRow({ session, open, dispatch }: { session: ImportedSession; open: boolean; dispatch: (a: PlanImportAction) => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <ListRow
        left={<SportBadge sport={session.sport} size={32} />}
        title={session.title}
        subtitle={sessionLine(session)}
        right={session.confidence === 'low' ? <Tag label="Revisar" color={colors.warning} icon="warning" /> : undefined}
        onPress={() => dispatch({ type: 'edit', key: open ? null : session.key })}
        showChevron={false}
      />
      {open ? <SessionEditor session={session} dispatch={dispatch} /> : null}
    </View>
  );
}

/** Review before saving: name, start week, replace toggle and the sessions by week (edit / delete). */
export function PlanReview({ plan, start, today, replace, editing, error, dispatch }: PlanReviewProps) {
  const weeks = sessionsByWeek(plan);
  const { skipped } = importToWorkouts(plan, start, today);
  return (
    <Stack gap="lg">
      <TextField label="Nombre del plan" value={plan.title} onChangeText={(title) => dispatch({ type: 'setTitle', title })} maxLength={120} />
      <Text variant="caption" color="textMuted">
        {`${plan.sessions.length} sesiones en ${weeks.length} ${weeks.length === 1 ? 'semana' : 'semanas'} · ${planImportSourceLabel(plan.source)} · ${plan.engine === 'ai' ? 'leído con IA' : 'leído en tu iPhone'}`}
      </Text>
      <ConfidenceNotice plan={plan} />
      <Card>
        <Stack gap="sm">
          <Text variant="heading">¿Cuándo empieza la semana 1?</Text>
          <View style={styles.startRow}>
            <IconButton icon="chevronLeft" accessibilityLabel="Una semana antes" onPress={() => dispatch({ type: 'shiftStart', weeks: -1, today })} />
            <Text variant="bodyStrong" align="center" style={styles.flex}>
              {formatDayLong(start)}
            </Text>
            <IconButton icon="chevronRight" accessibilityLabel="Una semana después" onPress={() => dispatch({ type: 'shiftStart', weeks: 1, today })} />
          </View>
          <Text variant="caption" color="textMuted">
            {plan.sourceStart === start
              ? 'Son las fechas del plan original. Puedes moverlo si empiezas más tarde.'
              : `El plan acaba la semana del ${formatWeekRange(addDays(start, (weeks[weeks.length - 1]?.week ?? 1) * 7 - 7))}.`}
          </Text>
          {skipped > 0 ? (
            <Text variant="caption" color="warning">
              {`${skipped} ${skipped === 1 ? 'sesión cae' : 'sesiones caen'} antes de hoy y no se ${skipped === 1 ? 'importará' : 'importarán'}.`}
            </Text>
          ) : null}
        </Stack>
      </Card>
      <SwitchRow
        icon="refresh"
        title="Sustituir lo que planificó la app"
        subtitle="En las semanas del plan quito las sesiones que generó la app. Las tuyas, las quedadas y lo ya hecho se quedan."
        value={replace}
        onChange={() => dispatch({ type: 'toggleReplace' })}
      />
      {weeks.map((w) => (
        <Disclosure
          key={w.week}
          variant="card"
          title={`Semana ${w.week} · ${formatWeekRange(addDays(start, (w.week - 1) * 7))}`}
          summary={`${w.sessions.length} ${w.sessions.length === 1 ? 'sesión' : 'sesiones'} · ${formatDuration(w.minutes)}${w.sessions.some((s) => s.confidence === 'low') ? ' · revisar' : ''}`}
          icon="week"
          defaultOpen={w.week === weeks[0]?.week}>
          {w.sessions.map((s) => (
            <SessionRow key={s.key} session={s} open={editing === s.key} dispatch={dispatch} />
          ))}
        </Disclosure>
      ))}
      {error ? <ErrorNotice message={error} /> : null}
    </Stack>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  editor: { paddingVertical: space.sm },
  editorActions: { flexDirection: 'row', justifyContent: 'space-between' },
  startRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
