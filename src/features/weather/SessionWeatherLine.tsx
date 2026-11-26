import { StyleSheet, View } from 'react-native';

import { Icon, Text, space, useTheme } from '@/ui';

import { WeatherCredit } from './WeatherCredit';
import type { SessionWeatherView } from './weatherModel';

/** One quiet line about the weather of a session, with the data credit under it. */
export function SessionWeatherLine({ view }: { view: SessionWeatherView }) {
  const { colors } = useTheme();
  if (!view.line) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessible accessibilityLabel={`El tiempo: ${view.line}`}>
        <Icon name={view.rainy ? 'rain' : 'cloudSun'} size={16} color={colors.textMuted} />
        <Text variant="callout" color={view.rainy ? 'text' : 'textMuted'} style={styles.flex}>
          {view.line}
        </Text>
      </View>
      <WeatherCredit source={view.source} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
});
