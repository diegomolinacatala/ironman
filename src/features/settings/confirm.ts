import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type WebConfirm = (message?: string) => boolean;

function webConfirm(): WebConfirm | null {
  const candidate = (globalThis as { confirm?: unknown }).confirm;
  return typeof candidate === 'function' ? (candidate as WebConfirm) : null;
}

/**
 * Asks the user to confirm an action. Native: `Alert.alert` with two buttons.
 * Web: `window.confirm` (react-native-web's Alert is a no-op).
 * Resolves `true` only when the user explicitly confirms.
 */
export function confirmAction({
  title,
  message,
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    const confirm = webConfirm();
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(confirm ? confirm(text) : false);
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
