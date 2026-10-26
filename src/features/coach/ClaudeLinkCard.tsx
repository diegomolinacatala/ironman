import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text, space, useTheme } from '@/ui';

/** Link to "Conecta tu Claude" (personal MCP connector). */
export function ClaudeLinkCard() {
  const { colors } = useTheme();
  return (
    <Card
      variant="flat"
      padding="md"
      onPress={() => router.push('/settings/claude')}
      accessibilityLabel="Usa tu propio Claude. Conecta tu Claude, que ya lee tu Garmin, para que planifique en Road to Ironman.">
      <View style={styles.row}>
        <View style={[styles.glyph, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name="link" size={18} color={colors.text} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyStrong">Usa tu propio Claude</Text>
          <Text variant="caption" color="textMuted">
            Tu Claude ya lee tu Garmin: conéctalo y propondrá cambios aquí para que los revises.
          </Text>
        </View>
        <Icon name="chevronRight" size={14} color={colors.textFaint} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  glyph: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
