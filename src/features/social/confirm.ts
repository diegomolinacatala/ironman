/**
 * Cross-platform dialogs for the social area.
 *
 * `Alert.alert` is a no-op on react-native-web, so on web we fall back to the
 * browser's `window.confirm` / `window.alert` (demo mode in the web preview).
 */
import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface MenuAction {
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}

interface WebDialogs {
  confirm?: (message?: string) => boolean;
  alert?: (message?: string) => void;
}

function webDialogs(): WebDialogs {
  return globalThis as unknown as WebDialogs;
}

function joinText(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

/** Resolves `true` when the user confirms. Never rejects. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmLabel, cancelLabel = 'Cancelar', destructive = false } = options;
  if (Platform.OS === 'web') {
    const { confirm } = webDialogs();
    return Promise.resolve(typeof confirm === 'function' ? confirm(joinText(title, message)) : true);
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

/** Informational message (errors, "copiado"…). */
export function showNotice(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    const { alert } = webDialogs();
    if (typeof alert === 'function') alert(joinText(title, message));
    return;
  }
  Alert.alert(title, message);
}

/**
 * Small options menu. Native: an alert with one button per action. Web: a
 * single action runs directly (it is expected to confirm itself); several
 * actions are offered one by one with `confirm`.
 */
export function showActionMenu(title: string, actions: readonly MenuAction[]): void {
  if (actions.length === 0) return;
  if (Platform.OS === 'web') {
    const first = actions[0];
    if (actions.length === 1 && first) {
      first.onSelect();
      return;
    }
    const { confirm } = webDialogs();
    const chosen = actions.find((action) => (typeof confirm === 'function' ? confirm(`${action.label}?`) : false));
    chosen?.onSelect();
    return;
  }
  Alert.alert(title, undefined, [
    ...actions.map((action) => ({
      text: action.label,
      style: action.destructive ? ('destructive' as const) : ('default' as const),
      onPress: action.onSelect,
    })),
    { text: 'Cancelar', style: 'cancel' as const },
  ]);
}
