import { StyleSheet, View } from 'react-native';

import type { SeasonOverview, SeasonWeek } from '@/domain/season';
import { Card, Icon, Text, space, useTheme } from '@/ui';

import { formatSeasonHours, previewTitle, previewWeekLabel, weekDates, weekKindIcon } from './seasonModel';

/** Weeks the preview lists. */
export const PREVIEW_WEEKS = 4;

export interface SeasonPreviewProps {
  season: SeasonOverview;
}

/** Compact "Así llegarás a tu carrera": the season summary and the next 4 weeks with their hours. */
export function SeasonPreview({ season }: SeasonPreviewProps) {
  const weeks = season.weeks.slice(0, PREVIEW_WEEKS);
  return (
    <Card variant="flat" padding="lg" style={styles.card}>
      <View style={styles.head}>
        <Text variant="heading" accessibilityRole="header">
          {previewTitle(season)}
        </Text>
        {season.summary ? (
          <Text variant="callout" color="textMuted">
            {season.summary}
          </Text>
        ) : null}
      </View>
      <View style={styles.rows}>
        {weeks.map((week) => (
          <PreviewRow key={week.weekStart} week={week} />
        ))}
      </View>
    </Card>
  );
}

function PreviewRow({ week }: { week: SeasonWeek }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={previewWeekLabel(week)} testID={week.isCurrent ? 'preview-week-current' : undefined}>
      <View style={[styles.tile, { backgroundColor: week.isCurrent ? colors.accentSoft : colors.surfaceAlt }]}>
        <Icon name={weekKindIcon(week.kind, week.label)} size={16} color={week.isCurrent ? colors.onAccentSoft : colors.textMuted} />
      </View>
      <View style={styles.text}>
        <Text variant="bodyStrong">{week.label}</Text>
        <Text variant="caption" color="textMuted">
          {week.isCurrent ? `Esta semana · ${weekDates(week.weekStart)}` : weekDates(week.weekStart)}
        </Text>
      </View>
      <Text variant="metricSmall">{formatSeasonHours(week.targetMinutes)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  head: { gap: space.xs },
  rows: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
