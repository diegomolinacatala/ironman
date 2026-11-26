import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, haptics, radius, space, useTheme, type IconName } from '@/ui';

interface Action {
  label: string;
  hint: string;
  icon: IconName;
  route: Href;
}

export function QuickActions({ checkinDone }: { checkinDone: boolean }) {
  const { colors } = useTheme();
  const actions: Action[] = [
    { label: 'Mi coach', hint: 'Hablar con mi coach', icon: 'mic', route: '/talk' },
    { label: 'Sensaciones', hint: checkinDone ? 'Revisar mis sensaciones de hoy' : 'Registrar mis sensaciones de hoy', icon: checkinDone ? 'checkCircle' : 'checkin', route: '/checkin' },
    { label: 'Imprevisto', hint: 'Apuntar un imprevisto', icon: 'eventAdd', route: '/event/edit' },
  ];
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {actions.map((action) => (
        <Pressable
          key={action.route.toString()}
          accessibilityRole="button"
          accessibilityLabel={action.hint}
          onPress={() => {
            haptics.tap();
            router.push(action.route);
          }}
          style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.surfacePressed }]}>
          <Icon name={action.icon} size={20} color={colors.accentInk} />
          <Text variant="caption" align="center">{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.md, paddingHorizontal: space.xs, gap: space.xs, minHeight: 60 },
});
