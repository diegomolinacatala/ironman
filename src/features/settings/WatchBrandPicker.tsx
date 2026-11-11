import { StyleSheet, View } from 'react-native';

import { ErrorNotice, Icon, Segmented, Text, space, useTheme } from '@/ui';

import type { WatchBrandChoice } from './useWatchBrand';
import { WATCH_BRAND_OPTIONS, watchBrandHint } from './watchBrand';

/**
 * "Tu reloj": Garmin | COROS, saved to the profile right away. A row of its own
 * (no card): inside Tú › Conexiones, or wrapped in a card on /settings/integrations.
 */
export function WatchBrandPicker({ choice }: { choice: WatchBrandChoice }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
          <Icon name="watch" size={18} color={colors.onAccentSoft} />
        </View>
        <View style={styles.text}>
          <Text variant="bodyStrong">Tu reloj</Text>
          <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
            {watchBrandHint(choice.brand)}
          </Text>
        </View>
      </View>
      <Segmented accessibilityLabel="Tu reloj" options={WATCH_BRAND_OPTIONS} value={choice.brand} onChange={(brand) => void choice.choose(brand)} />
      {choice.error ? <ErrorNotice message={choice.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, paddingVertical: space.md, paddingHorizontal: space.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
