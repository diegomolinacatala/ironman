import { ScrollView, StyleSheet } from 'react-native';

import { Chip, space } from '@/ui';

import { QUICK_ACTIONS, type QuickActionId } from './requests';

export interface QuickActionsProps {
  onPick: (id: QuickActionId) => void;
  disabled?: boolean;
}

/** Horizontal row of one-tap coach requests. */
export function QuickActions({ onPick, disabled = false }: QuickActionsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}
      accessibilityLabel="Acciones rápidas del coach">
      {QUICK_ACTIONS.map((action) => (
        <Chip
          key={action.id}
          label={action.label}
          icon={action.icon}
          disabled={disabled}
          onPress={() => onPick(action.id)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingVertical: space.xs },
});
