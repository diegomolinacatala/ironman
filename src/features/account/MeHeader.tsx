import { StyleSheet, View } from 'react-native';

import { sportLabel } from '@/domain/labels';
import type { Profile } from '@/domain/types';
import { Avatar, ProgressRing, SportBadge, Tag, Text, space, useTheme } from '@/ui';

import { formatMinutesCompact } from '../settings/format';
import type { WeekStats } from './useWeekStats';

export interface MeHeaderProps {
  profile: Profile;
  stats: WeekStats;
  isDemo: boolean;
}

/** Identity block + this-week mini stats (hours done/planned, compliance). */
export function MeHeader({ profile, stats, isDemo }: MeHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.identity}>
        <View style={[styles.avatarRing, { borderColor: colors.text }]}>
          <Avatar name={profile.displayName} size={72} />
        </View>
        <View style={styles.names}>
          <Text variant="display" numberOfLines={1} adjustsFontSizeToFit accessibilityRole="header">
            {profile.displayName}
          </Text>
          <Text variant="bodyStrong" color="textMuted">
            @{profile.username}
          </Text>
          <View style={styles.badges} accessible accessibilityLabel={`Deportes: ${profile.sports.map(sportLabel).join(', ')}`}>
            {profile.sports.map((sport) => (
              <SportBadge key={sport} sport={sport} size={26} />
            ))}
            {isDemo ? <Tag label="Modo demo" color={colors.info} icon="sparkles" /> : null}
          </View>
        </View>
      </View>
      <WeekStrip stats={stats} />
    </View>
  );
}

function WeekStrip({ stats }: { stats: WeekStats }) {
  const { colors } = useTheme();
  const pct = stats.compliancePct;
  const pctLabel = pct === null ? '—' : `${Math.round(pct * 100)}%`;
  return (
    <View style={[styles.strip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.stat} accessible accessibilityLabel={`Esta semana: ${formatMinutesCompact(stats.completedMin)} de ${formatMinutesCompact(stats.plannedMin)}`}>
        <Text variant="overline" color="textMuted">
          Esta semana
        </Text>
        <Text variant="metric">
          {stats.isLoading ? '…' : formatMinutesCompact(stats.completedMin)}
          <Text variant="callout" color="textMuted">
            {' '}
            / {formatMinutesCompact(stats.plannedMin)}
          </Text>
        </Text>
        <Text variant="caption" color="textMuted">
          {stats.completedSessions} de {stats.sessions} sesiones
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.ringStat} accessible accessibilityLabel={`Cumplimiento ${pctLabel}`}>
        <ProgressRing value={pct ?? 0} size={64} stroke={7} color={colors.text}>
          <Text variant="metricSmall">{pctLabel}</Text>
        </ProgressRing>
        <Text variant="overline" color="textMuted">
          Cumplimiento
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  avatarRing: { borderWidth: 3, borderRadius: 42, padding: 3 },
  names: { flex: 1, gap: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  strip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 22, padding: space.lg, gap: space.lg },
  stat: { flex: 1, gap: 2 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  ringStat: { alignItems: 'center', gap: space.xs },
});
