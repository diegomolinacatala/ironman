import { StyleSheet, View } from 'react-native';

import { levelLabel, raceDistanceLabel } from '@/domain/labels';
import type { ISODate } from '@/domain/types';
import { Card, ErrorNotice, Row, SportBadge, Text, space, useTheme } from '@/ui';

import { formatHours } from '../settings/availabilityModel';
import { daysUntil, formatDateShort } from '../settings/format';
import { countThresholds, parseThresholdInputs } from '../settings/thresholdsModel';
import { raceDraftFromInput, type OnboardingState } from './onboardingModel';

export interface DoneStepProps {
  state: OnboardingState;
  today: ISODate;
  error: string | null;
  warning: string | null;
}

/** Step 7: race-bib summary of what was collected before saving. */
export function DoneStep({ state, today, error, warning }: DoneStepProps) {
  const { colors, isDark } = useTheme();
  const race = raceDraftFromInput(state.race);
  const thresholds = countThresholds(parseThresholdInputs(state.thresholds).thresholds);
  const ink = isDark ? colors.bgElevated : colors.inverseBg;
  const paper = isDark ? colors.text : colors.inverseText;

  return (
    <View style={styles.wrap}>
      <Card variant="tinted" tint={ink} padding="xl">
        <Text variant="overline" style={{ color: colors.accent }}>
          Dorsal
        </Text>
        <Text variant="display" style={{ color: paper }} numberOfLines={1} adjustsFontSizeToFit>
          {state.displayName.trim() || 'Atleta'}
        </Text>
        <Text variant="bodyStrong" style={{ color: paper, opacity: 0.75 }}>
          @{state.username}
        </Text>
        <Row gap="xs" style={styles.badges}>
          {state.sports.map((sport) => (
            <SportBadge key={sport} sport={sport} size={30} tone="solid" />
          ))}
        </Row>
      </Card>
      <View style={styles.grid}>
        <Stat label="Horas/semana" value={formatHours(state.availability.weeklyHoursTarget)} />
        <Stat label="Nivel" value={levelLabel(state.level)} />
        <Stat label="Franjas" value={String(state.availability.windows.length)} />
        <Stat label="Umbrales" value={`${thresholds}/5`} />
      </View>
      {race ? (
        <Card padding="lg" rail={colors.accent}>
          <Text variant="overline" color="textMuted">
            Objetivo · {raceDistanceLabel(race.distance)} · {race.priority}
          </Text>
          <Text variant="heading">{race.name}</Text>
          <Text variant="metric">
            {daysUntil(race.date, today)}
            <Text variant="callout" color="textMuted">
              {' '}
              días · {formatDateShort(race.date)}
            </Text>
          </Text>
        </Card>
      ) : null}
      {warning ? <ErrorNotice message={warning} /> : null}
      {error ? <ErrorNotice message={error} /> : null}
      <Text variant="callout" color="textMuted">
        Al empezar, el coach te propondrá la semana con tus huecos. Tú decides qué aceptas.
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text variant="overline" color="textMuted">
        {label}
      </Text>
      <Text variant="metricSmall" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  badges: { marginTop: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: space.md, gap: space.xs },
});
