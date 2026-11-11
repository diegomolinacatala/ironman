import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import type { SeasonWeek, SeasonWeekKind } from '@/domain/season';
import { hoursLabel } from '@/features/week/weekModel';
import { Icon, Text, radius, space, useTheme, type Theme } from '@/ui';

import { legendItems, stripMarker, volumeSpoken, type LegendItem } from './seasonModel';

const BAR_MAX = 64;
const BAR_MIN = 4;
/** Hours labels may grow a little with Dynamic Type, never past the column. */
const LABEL_SCALE = 1.2;

/**
 * Bar fill per kind of week. Load weeks are solid brand; descarga, semana libre,
 * afinamiento and carrera look different AND carry a marker icon (never colour alone).
 */
function barStyle(kind: SeasonWeekKind, colors: Theme['colors']): ViewStyle {
  switch (kind) {
    case 'load':
    case 'push':
      return { backgroundColor: colors.accent };
    case 'taper':
      return { backgroundColor: colors.accent, opacity: 0.45 };
    case 'race':
      return { backgroundColor: colors.accentInk };
    case 'recovery':
    case 'transition':
      return { backgroundColor: colors.borderStrong };
    case 'rest':
      return { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong };
  }
}

/** One bar per week, height ∝ target hours, the current week on a soft brand column. One image for screen readers. */
export function VolumeStrip({ weeks }: { weeks: readonly SeasonWeek[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.targetMinutes));
  const legend = legendItems(weeks);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={volumeSpoken(weeks)} style={styles.root}>
      <Text variant="caption" color="textMuted">
        Horas por semana
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {weeks.map((week) => (
          <VolumeColumn key={week.weekStart} week={week} max={max} />
        ))}
      </ScrollView>
      {legend.length > 0 ? <Legend items={legend} /> : null}
    </View>
  );
}

function VolumeColumn({ week, max }: { week: SeasonWeek; max: number }) {
  const { colors } = useTheme();
  const marker = stripMarker(week.kind);
  const height = Math.max(BAR_MIN, Math.round((week.targetMinutes / max) * BAR_MAX));
  const ink = week.isCurrent ? colors.onAccentSoft : colors.textMuted;
  return (
    <View style={[styles.column, week.isCurrent && { backgroundColor: colors.accentSoft }]} testID={week.isCurrent ? 'volume-current' : undefined}>
      <Text variant="caption" maxFontSizeMultiplier={LABEL_SCALE} numberOfLines={1} style={[styles.hours, { color: ink }]}>
        {hoursLabel(week.targetMinutes)}
      </Text>
      <View style={styles.barSlot}>
        <View style={[styles.bar, barStyle(week.kind, colors), { height }]} />
      </View>
      <View style={styles.marker}>{marker ? <Icon name={marker} size={12} color={ink} /> : null}</View>
    </View>
  );
}

function Legend({ items }: { items: readonly LegendItem[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <Icon name={item.icon} size={12} color={colors.textMuted} />
          <Text variant="caption" color="textMuted">
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  track: { flexGrow: 1, gap: space.xs },
  column: {
    flex: 1,
    minWidth: 38,
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs + 2,
    borderRadius: radius.sm,
  },
  hours: { fontSize: 11, lineHeight: 14, fontVariant: ['tabular-nums'] },
  barSlot: { height: BAR_MAX, justifyContent: 'flex-end', alignItems: 'center', alignSelf: 'stretch' },
  bar: { width: 14, borderRadius: 4 },
  marker: { height: 14, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
