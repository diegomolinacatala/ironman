import { StyleSheet, View } from 'react-native';

import { Card, Icon, SportBadge, Text, fonts, radius, space, useTheme } from '@/ui';

import type { TodayAdvice, TodaySession } from './todayAdvice';

function SessionHead({ session }: { session: TodaySession }) {
  return (
    <View style={styles.head} accessible accessibilityLabel={`Tu sesión de hoy: ${session.title}. ${session.detail}`}>
      <SportBadge sport={session.sport} size={32} />
      <View style={styles.flex}>
        <Text variant="caption" color="textMuted">
          Tu sesión de hoy
        </Text>
        <Text variant="heading">{session.title}</Text>
        <Text variant="callout" color="textMuted" style={styles.detail}>
          {session.detail}
        </Text>
      </View>
    </View>
  );
}

/**
 * Today's session after the check-in: what it asks ("Carrera · 55' · Z4 · 162–168 ppm"), what to
 * do with it given your readiness and, on amber or red days, its easier version.
 */
export function TodayAdviceCard({ advice }: { advice: TodayAdvice }) {
  const { colors } = useTheme();
  const { session, message, alternative } = advice;
  if (!session && !message) return null;
  return (
    <Card padding="md" style={styles.card}>
      {session ? <SessionHead session={session} /> : null}
      {message ? <Text variant="body">{message}</Text> : null}
      {alternative ? (
        <View style={[styles.well, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name="lightbulb" size={16} color={colors.textMuted} />
          <Text variant="callout" style={styles.flex}>
            {alternative}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  flex: { flex: 1 },
  detail: { fontFamily: fonts.bodySemibold, fontVariant: ['tabular-nums'] },
  well: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
});
