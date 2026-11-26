import { StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { Button, Card, Icon, Text, space, useTheme } from '@/ui';

import { useAdaptNudge } from './useAdaptNudge';

/**
 * Hoy's quiet offer to adapt the plan by itself: today's hard session when the watch says the
 * athlete is tired (no check-in yet), or a key session missed in the last two days. One card at
 * most; "Ahora no" hides it for the day; the change is a proposal the athlete reviews.
 */
export function AdaptNudgeCard({ today, checkinDone }: { today: ISODate; checkinDone: boolean }) {
  const { colors } = useTheme();
  const { nudge, run, dismiss, busy, message } = useAdaptNudge(today, checkinDone);
  if (!nudge && !message) return null;
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="md" accessibilityLabel={nudge ? `${nudge.title}. ${nudge.detail}` : message ?? undefined}>
      <View style={styles.row}>
        <Icon name={nudge?.kind === 'missed' ? 'week' : 'sunrise'} size={18} color={colors.onAccentSoft} />
        <View style={styles.flex}>
          {nudge ? (
            <>
              <Text variant="bodyStrong">{nudge.title}</Text>
              <Text variant="callout" color="textMuted">
                {nudge.detail}
              </Text>
            </>
          ) : null}
          {message ? (
            <Text variant="callout" color="textMuted">
              {message}
            </Text>
          ) : null}
        </View>
      </View>
      {nudge ? (
        <View style={styles.actions}>
          <Button label={nudge.action} size="sm" loading={busy} onPress={() => void run()} />
          <Button label="Ahora no" size="sm" variant="ghost" onPress={dismiss} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, marginLeft: 18 + space.sm },
});
