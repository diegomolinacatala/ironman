import { StyleSheet, View } from 'react-native';

import type { ISODate, UUID } from '@/domain/types';
import { useFeed } from '@/data/queries';
import { errorMessage } from '@/lib/logger';
import { Divider, ErrorNotice, Loading, SectionHeader, Text, space } from '@/ui';

import { FeedItemRow } from './FeedItemRow';

const FEED_LIMIT = 30;

/** "Actividad": light feed of my circle, newest first, with kudos. */
export function FeedSection({ myId, today }: { myId: UUID | null; today: ISODate }) {
  const feed = useFeed(FEED_LIMIT);
  const items = feed.data ?? [];
  return (
    <View style={styles.section}>
      <SectionHeader title="Actividad" />
      {feed.isLoading ? <Loading label="Cargando actividad" /> : null}
      {feed.error ? (
        <ErrorNotice message={errorMessage(feed.error, 'No se ha podido cargar la actividad.')} onRetry={() => void feed.refetch()} />
      ) : null}
      {!feed.isLoading && !feed.error && items.length === 0 ? (
        <Text variant="callout" color="textMuted">
          Aquí verás los entrenos completados de tus amigos. Dales un aplauso para animarles.
        </Text>
      ) : null}
      <View>
        {items.map((item, index) => (
          <View key={item.id}>
            {index > 0 ? <Divider /> : null}
            <FeedItemRow item={item} myId={myId} today={today} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.xs },
});
