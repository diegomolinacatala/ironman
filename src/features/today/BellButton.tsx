import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IconButton, Text, useTheme } from '@/ui';

/** Bell with unread badge → /notifications. */
export function BellButton({ unread }: { unread: number }) {
  const { colors } = useTheme();
  const label = unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos';
  return (
    <View>
      <IconButton icon="bell" variant="filled" size={44} accessibilityLabel={label} onPress={() => router.push('/notifications')} />
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.bg }]}>
          <Text variant="caption" style={styles.badgeText} allowFontScaling={false}>
            {unread > 9 ? '9+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    pointerEvents: 'none',
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, lineHeight: 13 },
});
