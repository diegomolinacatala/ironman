/**
 * Hoy · quick actions under the header: check-in, "imprevisto" (new life event) and, when the
 * coach bar isn't shown inline on Hoy, a meal photo. One quiet row of pills, icon + short label.
 */
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, haptics, iconSize, radius, space, useTheme, type IconName } from '@/ui';

export const CHECKIN_ROUTE = '/checkin';
export const NEW_EVENT_ROUTE = '/event/edit';
export const MEAL_ROUTE = '/meal';


interface QuickAction {
  key: string;
  icon: IconName;
  label: string;
  a11y: string;
  route: Href;
  done?: boolean;
}

export function quickActions({ checkinDone, showMeal }: QuickActionsProps): QuickAction[] {
  const checkin: QuickAction = checkinDone
    ? { key: 'checkin', icon: 'checkCircle', label: 'Check-in hecho', a11y: 'Check-in de hoy hecho. Revisar', route: CHECKIN_ROUTE, done: true }
    : { key: 'checkin', icon: 'checkin', label: 'Check-in', a11y: 'Hacer el check-in de hoy', route: CHECKIN_ROUTE };
  const event: QuickAction = { key: 'event', icon: 'eventAdd', label: 'Imprevisto', a11y: 'Apuntar un imprevisto', route: NEW_EVENT_ROUTE };
  const meal: QuickAction = { key: 'meal', icon: 'camera', label: 'Comida', a11y: 'Apuntar una comida', route: MEAL_ROUTE };
  return showMeal ? [checkin, event, meal] : [checkin, event];
}

function ActionTile({ action }: { action: QuickAction }) {
  const { colors } = useTheme();
  const iconFg = action.done ? colors.success : colors.accentInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.a11y}
      onPress={() => {
        haptics.tap();
        router.push(action.route);
      }}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
          borderColor: colors.border,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}>
      <Icon name={action.icon} size={iconSize.sm} color={iconFg} />
      <Text variant="caption" color={action.done ? 'textMuted' : 'text'} numberOfLines={1} style={styles.label}>
        {action.label}
      </Text>
    </Pressable>
  );
}

export interface QuickActionsProps {
  /** Today's check-in is already saved (the tile then reads "Check-in hecho"). */
  checkinDone: boolean;
  /** Show "Comida" (only when the coach bar with its camera isn't inline on Hoy). */
  showMeal: boolean;
}

export function QuickActions(props: QuickActionsProps) {
  return (
    <View style={styles.row}>
      {quickActions(props).map((action) => (
        <ActionTile key={action.key} action={action} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  label: { fontSize: 14, flexShrink: 1 },
  tile: {
    flex: 1,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 44,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
