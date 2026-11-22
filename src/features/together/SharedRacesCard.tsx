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
import { Card, Disclosure, Icon, SectionHeader, Text, radius, space, useTheme } from '@/ui';

import { countdownLabel, sharedRaces } from './sharedModel';

const MAX_OTHERS = 3;

function friendRaceLine(r: FriendRace, today: ISODate): string {
  return [r.name ?? raceDistanceLabel(r.distance), formatDayLabel(r.date, today)].join(' · ');
}

/** `folded`: a closed "Carreras" section (Juntos keeps the secondary content folded). */
export function SharedRacesCard({ today, folded = false }: { today: ISODate; folded?: boolean }) {
  const { colors } = useTheme();
  const mine = useRaces();
  const friends = useFriendRaces();
  const friendRaces = friends.data ?? [];
  const shared = sharedRaces(mine.data ?? [], friendRaces, today);
  const sharedIds = new Set(shared.flatMap((s) => s.friends.map((f) => f.raceId)));
  const others = friendRaces.filter((r) => !sharedIds.has(r.raceId)).slice(0, MAX_OTHERS);
  if (shared.length === 0 && others.length === 0) return null;

  const title = shared.length > 0 ? 'Carreras juntos' : 'Carreras de tus amigos';
  const body = (
    <View style={styles.section}>
      {folded ? null : <SectionHeader title={title} />}
      {shared.map((s) => (
        <Card key={s.race.id} padding="md" variant="tinted" tint={colors.accentSoft}>
          <View style={styles.row}>
            <View style={[styles.tile, { backgroundColor: colors.surface }]}>
              <Icon name="trophy" size={20} color={colors.accentInk} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong" color="onAccentSoft">
                {s.race.name}
              </Text>
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
  if (!folded) return body;
  const summary = shared.length > 0 ? `${shared.length === 1 ? '1 carrera' : `${shared.length} carreras`} con amigos` : `${others.length} de tus amigos`;
  return (
    <Disclosure variant="plain" title={title} summary={summary} storageKey="together.races">
      {body}
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  tile: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
