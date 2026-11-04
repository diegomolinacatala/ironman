import { StyleSheet, View } from 'react-native';

import type { QuedadaSuggestion } from '@/domain/types';
import { openJointNew } from '@/features/together/navigation';
import { Button, Card, Icon, SportBadge, Text, space, useTheme } from '@/ui';

import { prefillFromQuedada, quedadaDetail, quedadaHeading } from './quedadaSuggestion';

export interface QuedadaSuggestionCardProps {
  quedada: QuedadaSuggestion;
}

/**
 * The quedada your coach suggests with a friend. Nothing is sent from here:
 * the button opens the "nueva quedada" form prefilled, to review and send.
 */
export function QuedadaSuggestionCard({ quedada }: QuedadaSuggestionCardProps) {
  const { colors } = useTheme();
  const heading = quedadaHeading(quedada);
  const detail = quedadaDetail(quedada);
  return (
    <Card variant="raised" style={styles.card}>
      <View style={styles.head} accessible accessibilityLabel={`${heading}. ${detail}`}>
        <SportBadge sport={quedada.sport} size={36} />
        <View style={styles.flex}>
          <Text variant="overline" color="textMuted">
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
          <Icon name="together" size={14} color={colors.textMuted} />
          <Text variant="caption" color="textMuted" style={styles.flex}>
            {quedada.reason}
          </Text>
        </View>
      ) : null}
      <Button
        label="Preparar la invitación"
        icon="send"
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
  flex: { flex: 1 },
});
