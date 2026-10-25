import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { logger } from '@/lib/logger';
import { useTheme } from '@/ui';

const BUTTON_HEIGHT = 52;

/** Resolves whether native Sign in with Apple can be shown (iOS only). */
export function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((value) => {
        if (active) setAvailable(value);
      })
      .catch((error: unknown) => logger.warn('apple availability check failed', error));
    return () => {
      active = false;
    };
  }, []);
  return available;
}

/** Apple's native "Continuar con Apple" button (system-localised, HIG compliant). */
export function AppleSignInButton({ onPress }: { onPress: () => void }) {
  const { isDark } = useTheme();
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={
        isDark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={BUTTON_HEIGHT / 2}
      style={styles.button}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  button: { height: BUTTON_HEIGHT, width: '100%' },
});
