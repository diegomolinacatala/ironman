import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, IconButton, Text, space, useTheme, type IconName } from '@/ui';

/**
 * The calm shell of Hoy's one-question cards (Tu semana, Tu fin de semana, ¿Sales con
 * alguien?): icon, overline-free title, one line of context, the answers and a close button.
 */
export function QuestionCard({
  icon,
  title,
  detail,
  onDismiss,
  dismissLabel = 'Ahora no',
  children,
  testID,
}: {
  icon: IconName;
  title: string;
  detail?: string | null;
  onDismiss?: () => void;
  dismissLabel?: string;
  children?: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID}>
      <Card variant="tinted" tint={colors.accentSoft} padding="md" accessibilityLabel={detail ? `${title}. ${detail}` : title}>
        <View style={styles.row}>
          <Icon name={icon} size={18} color={colors.onAccentSoft} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">{title}</Text>
            {detail ? (
              <Text variant="callout" color="textMuted">
                {detail}
              </Text>
            ) : null}
          </View>
          {onDismiss ? <IconButton icon="close" size={32} onPress={onDismiss} accessibilityLabel={dismissLabel} /> : null}
        </View>
        {children ? <View style={styles.body}>{children}</View> : null}
      </Card>
    </View>
  );
}

/** A wrapping row of answer chips. */
export function AnswerChips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1, gap: 2 },
  body: { gap: space.sm, marginTop: space.sm, marginLeft: 18 + space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
