import { Pressable, StyleSheet, View } from 'react-native';

import type { SeasonWeek } from '@/domain/season';
import { Button, Icon, Tag, Text, haptics, radius, space, useTheme } from '@/ui';

import {
  adjustBlockedReason,
  detailLabel,
  formatSeasonHours,
  formatTrend,
  weekCaption,
  weekKindIcon,
  weekRowLabel,
  weekWhy,
} from './seasonModel';

export interface SeasonWeekRowProps {
  week: SeasonWeek;
  /** Sessions already planned in the week (0 = not detailed yet). */
  sessions: number;
  keySessions: readonly string[];
  /** Opens the week in the week view. */
  onOpen: (week: SeasonWeek) => void;
  /** Opens "Ajustar semana" (only called for editable weeks). */
  onAdjust: (week: SeasonWeek) => void;
}

/**
 * One week of the overview: what it is for, its dates and block, why, the key
 * sessions, target hours and trend. Tap → the week; long-press or the row action → "Ajustar semana".
 */
export function SeasonWeekRow({ week, sessions, keySessions, onOpen, onAdjust }: SeasonWeekRowProps) {
  const { colors } = useTheme();
  const blocked = adjustBlockedReason(week);
  const adjust = () => onAdjust(week);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={weekRowLabel(week, sessions, keySessions)}
        accessibilityHint="Abre la semana"
        testID={week.isCurrent ? 'season-week-current' : undefined}
        onPress={() => {
          haptics.tap();
          onOpen(week);
        }}
        onLongPress={
          blocked
            ? undefined
            : () => {
                haptics.impact();
                adjust();
              }
        }
        style={({ pressed }) => [styles.main, pressed && { backgroundColor: colors.surfacePressed }]}>
        <WeekTile week={week} />
        <View style={styles.body}>
          <Text variant="bodyStrong">{week.label}</Text>
          <Text variant="caption" color="textMuted">
            {weekCaption(week)}
          </Text>
          <Text variant="callout" color="textMuted" numberOfLines={2}>
            {weekWhy(week)}
          </Text>
          {keySessions.length > 0 ? <KeySessions names={keySessions} /> : null}
        </View>
        <Hours week={week} />
        <Icon name="chevronRight" size={14} color={colors.textFaint} />
      </Pressable>
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {/* Already part of the row's spoken label. */}
        <View style={styles.tags} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {week.plan ? <Tag label="Ajustada" color={colors.accentInk} icon="edit" /> : null}
          <Detail sessions={sessions} />
        </View>
        {blocked ? (
          <Blocked text={blocked} />
        ) : (
          <Button label="Ajustar semana" icon="edit" variant="ghost" size="sm" onPress={adjust} accessibilityHint={weekCaption(week)} />
        )}
      </View>
    </View>
  );
}

function WeekTile({ week }: { week: SeasonWeek }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: week.isCurrent ? colors.accentSoft : colors.surfaceAlt }]}>
      <Icon name={weekKindIcon(week.kind, week.label)} size={18} color={week.isCurrent ? colors.onAccentSoft : colors.textMuted} />
    </View>
  );
}

function Hours({ week }: { week: SeasonWeek }) {
  const trend = formatTrend(week.trend);
  return (
    <View style={styles.hours}>
      <Text variant="metricSmall">{formatSeasonHours(week.targetMinutes)}</Text>
      {trend ? (
        <Text variant="caption" color="textMuted" style={styles.tabular}>
          {trend}
        </Text>
      ) : null}
    </View>
  );
}

function KeySessions({ names }: { names: readonly string[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.inline}>
      <Icon name="target" size={14} color={colors.textMuted} />
      <Text variant="caption" style={styles.flex} numberOfLines={2}>
        {names.join(' · ')}
      </Text>
    </View>
  );
}

function Detail({ sessions }: { sessions: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.inline}>
      <Icon name={sessions > 0 ? 'calendarCheck' : 'week'} size={14} color={colors.textMuted} />
      <Text variant="caption" color="textMuted">
        {detailLabel(sessions)}
      </Text>
    </View>
  );
}

function Blocked({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.inline, styles.blocked]}>
      <Icon name="lock" size={12} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.shrink}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  main: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.lg },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  hours: { alignItems: 'flex-end', gap: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xxs },
  flex: { flex: 1 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  blocked: { flexShrink: 1, marginTop: 0 },
  shrink: { flexShrink: 1 },
});
