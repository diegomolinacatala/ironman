import { useState, type ReactNode } from 'react';
import { ActionSheetIOS, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Divider, Icon, Text, haptics, space, useTheme, type IconName } from '@/ui';

import { SheetModal } from './SheetModal';

export interface SheetAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
  destructive?: boolean;
}

export interface ActionSheetConfig {
  title: string;
  message?: string;
  actions: SheetAction[];
}

/**
 * Action menu: native ActionSheet on iOS, an in-app bottom sheet on Android
 * and web (where Alert cannot render more than a couple of buttons).
 * Render `element` somewhere in the screen tree.
 */
export function useActionSheet(): { open: (config: ActionSheetConfig) => void; element: ReactNode } {
  const { colors, isDark } = useTheme();
  const [config, setConfig] = useState<ActionSheetConfig | null>(null);

  const open = (next: ActionSheetConfig) => {
    if (Platform.OS === 'ios') {
      const options = [...next.actions.map((a) => a.label), 'Cancelar'];
      const destructive = next.actions.flatMap((a, i) => (a.destructive ? [i] : []));
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: next.title,
          message: next.message,
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: destructive,
          tintColor: colors.text,
          userInterfaceStyle: isDark ? 'dark' : 'light',
        },
        (index) => next.actions[index]?.onPress(),
      );
      return;
    }
    setConfig(next);
  };

  const close = () => setConfig(null);
  const element = (
    <SheetModal visible={config != null} onClose={close} title={config?.title ?? ''}>
      {config?.message ? (
        <Text variant="callout" color="textMuted">
          {config.message}
        </Text>
      ) : null}
      <View>
        {(config?.actions ?? []).map((action, index) => (
          <View key={action.label}>
            {index > 0 ? <Divider /> : null}
            <ActionRow
              action={action}
              onSelect={() => {
                close();
                action.onPress();
              }}
            />
          </View>
        ))}
      </View>
    </SheetModal>
  );
  return { open, element };
}

function ActionRow({ action, onSelect }: { action: SheetAction; onSelect: () => void }) {
  const { colors } = useTheme();
  const fg = action.destructive ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={() => {
        haptics.tap();
        onSelect();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}>
      {action.icon ? <Icon name={action.icon} size={18} color={fg} /> : null}
      <Text variant="bodyStrong" style={{ color: fg }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.xs },
});
