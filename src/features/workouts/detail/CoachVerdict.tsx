import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text, iconSize, space, useTheme } from '@/ui';

import type { CoachVerdictModel } from '../coachAdapters';
import { a11ySentences } from '../format';
import { CoachIconTile } from './CoachingCard';

/** The coach's verdict after a completed session: what happened vs the plan and what to do next. */
export function CoachVerdict({ verdict }: { verdict: CoachVerdictModel | null }) {
  const { colors } = useTheme();
  if (!verdict) return null;
  const a11y = a11ySentences(['Tu coach', verdict.title, verdict.detail, verdict.next]);
  return (
    <Card padding="md" style={styles.card}>
      <View accessible accessibilityLabel={a11y} style={styles.card}>
        <View style={styles.head}>
          <CoachIconTile icon="coach" />
          <View style={styles.flex}>
            <Text variant="caption" color="textMuted">
              Tu coach
            </Text>
            <Text variant="heading">{verdict.title}</Text>
          </View>
        </View>
        {verdict.detail ? <Text variant="body">{verdict.detail}</Text> : null}
        {verdict.next ? (
          <View style={styles.next}>
            <Icon name="arrowRight" size={iconSize.sm} color={colors.accentInk} />
            <Text variant="callout" style={styles.flex}>
              {verdict.next}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  next: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
