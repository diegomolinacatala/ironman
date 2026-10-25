/**
 * Cross-platform confirm / notify helpers.
 *
 * `Alert.alert` is a no-op on react-native-web, so on web we fall back to the
 * browser's `window.confirm` / `window.alert`.
 */
import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface BrowserDialogs {
  confirm?: (message?: string) => boolean;
  alert?: (message?: string) => void;
}

function browserDialogs(): BrowserDialogs | null {
  const candidate: unknown = typeof globalThis === 'object' ? (globalThis as { window?: unknown }).window : undefined;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as BrowserDialogs;
}

function joinText(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

/** Asks the user to confirm. Resolves true when confirmed. */
export function confirmAsync({
  title,
  message,
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    const dialogs = browserDialogs();
    return Promise.resolve(dialogs?.confirm ? dialogs.confirm(joinText(title, message)) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Shows a simple informational message. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    browserDialogs()?.alert?.(joinText(title, message));
    return;
  }
  Alert.alert(title, message);
}
