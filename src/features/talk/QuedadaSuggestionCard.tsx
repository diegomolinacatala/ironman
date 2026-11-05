import { StyleSheet, View } from 'react-native';

import type { QuedadaSuggestion } from '@/domain/types';
import { openJointNew } from '@/features/together/navigation';
import { Button, Card, Icon, SportBadge, Text, space, useTheme } from '@/ui';

import { prefillFromQuedada, quedadaDetail, quedadaHeading } from './quedadaSuggestion';

export interface QuedadaSuggestionCardProps {
  quedada: QuedadaSuggestion;
  /** A plan proposal holds the primary action: this button steps down to secondary. */
  quiet?: boolean;
}

/**
 * The quedada your coach suggests with a friend ("juntos" = soft brand tint). Nothing is sent
 * from here: the button opens the "nueva quedada" form prefilled, to review and send.
 */
export function QuedadaSuggestionCard({ quedada, quiet = false }: QuedadaSuggestionCardProps) {
  const { colors } = useTheme();
  const heading = quedadaHeading(quedada);
  const detail = quedadaDetail(quedada);
  return (
    <Card variant="tinted" tint={colors.accentSoft} style={styles.card}>
      <View style={styles.head} accessible accessibilityLabel={`${heading}. ${detail}`}>
        <SportBadge sport={quedada.sport} size={36} />
        <View style={styles.flex}>
          <Text variant="caption" color="onAccentSoft">
            Propuesta de tu coach
          </Text>
          <Text variant="heading">{heading}</Text>
          <Text variant="callout" color="textMuted">
            {detail}
          </Text>
        </View>
      </View>
      {quedada.reason ? (
        <View style={styles.reason}>
          <Icon name="together" size={14} color={colors.onAccentSoft} style={styles.reasonIcon} />
          <Text variant="caption" color="textMuted" style={styles.flex}>
            {quedada.reason}
          </Text>
        </View>
      ) : null}
      <Button
        label="Preparar la invitación"
        icon="send"
        variant={quiet ? 'secondary' : 'primary'}
        fullWidth
        accessibilityHint={`Abre la quedada con ${quedada.friendName} ya rellena para revisarla antes de enviarla`}
        onPress={() => openJointNew(prefillFromQuedada(quedada))}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  reasonIcon: { marginTop: 2 },
  flex: { flex: 1 },
});
