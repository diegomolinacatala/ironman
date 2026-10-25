import { StyleSheet, View } from 'react-native';

import { Icon, Text, space, useTheme } from '@/ui';

import { AI_NEVER_SHARED, AI_SHARED_DATA } from './aiConsent';

/** The data categories the Coach IA sends to Anthropic, plus what it never sends. */
export function AiSharedDataList() {
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      {AI_SHARED_DATA.map((item) => (
        <View key={item.label} style={styles.row}>
          <Icon name={item.icon} size={16} color={colors.text} />
          <Text variant="callout" style={styles.flex}>
            {item.label}
          </Text>
        </View>
      ))}
      <View style={styles.row}>
        <Icon name="lock" size={16} color={colors.success} />
        <Text variant="callout" color="textMuted" style={styles.flex}>
          {AI_NEVER_SHARED}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
});
