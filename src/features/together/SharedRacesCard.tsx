/**
 * "Vais juntos": races I share with friends (same day and distance or name),
 * with a countdown; plus friends' next races when we share none.
 */
import { StyleSheet, View } from 'react-native';

import { useFriendRaces, useRaces } from '@/data/queries';
import { formatDayLabel } from '@/domain/dates';
import { raceDistanceLabel } from '@/domain/labels';
import type { FriendRace, ISODate } from '@/domain/types';
import { firstName } from '@/features/social/friendModel';
import { joinNames } from '@/features/social/feedText';
import { Card, Icon, SectionHeader, Text, space, useTheme } from '@/ui';

import { countdownLabel, sharedRaces } from './sharedModel';

const MAX_OTHERS = 3;

function friendRaceLine(r: FriendRace, today: ISODate): string {
  return [r.name ?? raceDistanceLabel(r.distance), formatDayLabel(r.date, today)].join(' · ');
}

export function SharedRacesCard({ today }: { today: ISODate }) {
  const { colors } = useTheme();
  const mine = useRaces();
  const friends = useFriendRaces();
  const friendRaces = friends.data ?? [];
  const shared = sharedRaces(mine.data ?? [], friendRaces, today);
  const sharedIds = new Set(shared.flatMap((s) => s.friends.map((f) => f.raceId)));
  const others = friendRaces.filter((r) => !sharedIds.has(r.raceId)).slice(0, MAX_OTHERS);
  if (shared.length === 0 && others.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title={shared.length > 0 ? 'Carreras juntos' : 'Carreras de tus amigos'} />
      {shared.map((s) => (
        <Card key={s.race.id} padding="md" rail={colors.accent}>
          <View style={styles.row}>
            <Icon name="trophy" size={24} color={colors.accentInk} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">{s.race.name}</Text>
              <Text variant="caption" color="textMuted">
                Vas con {joinNames(s.friends.map((f) => firstName(f.displayName)))} · {countdownLabel(s.daysLeft)}
              </Text>
            </View>
          </View>
        </Card>
      ))}
      {others.length > 0 ? (
        <Card padding="md">
          <View style={styles.list}>
            {others.map((r) => (
              <View key={r.raceId} style={styles.row} accessible>
                <Icon name="flag" size={18} color={colors.textMuted} />
                <Text variant="callout" style={styles.flex}>
                  <Text variant="bodyStrong">{firstName(r.displayName)}</Text> · {friendRaceLine(r, today)}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
});
