import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet } from 'react-native';

import type { WeatherSource } from '@/domain/weather';
import { logger } from '@/lib/logger';
import { Text } from '@/ui';

/** MET Norway's licence page (NLOD 2.0 / CC BY 4.0): the credit links to it, as the licence asks. */
export const MET_LICENSE_URL = 'https://api.met.no/doc/License';

/** "Datos del tiempo: MET Norway" (or the demo's own note), wherever a forecast is shown. */
export function weatherCreditText(source: WeatherSource): string {
  return source === 'demo' ? 'Tiempo de ejemplo (modo demo)' : 'Datos del tiempo: MET Norway';
}

async function openLicense(): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(MET_LICENSE_URL);
  } catch (error) {
    logger.warn('weather: could not open the licence', error);
  }
}

/** Quiet credit line under a forecast; with MET data it opens the licence (CC BY 4.0). */
export function WeatherCredit({ source }: { source: WeatherSource }) {
  const text = weatherCreditText(source);
  if (source === 'demo') {
    return (
      <Text variant="caption" color="textMuted">
        {text}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${text}. Abre la licencia de los datos`}
      hitSlop={10}
      onPress={() => void openLicense()}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
      <Text variant="caption" color="textMuted">
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start', minHeight: 24, justifyContent: 'center' },
});
