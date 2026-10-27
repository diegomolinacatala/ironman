import { Redirect, Tabs } from 'expo-router';
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/tabs';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { CoachAccessory } from '@/features/accessory/CoachAccessory';
import { Icon, type IconName } from '@/ui/Icon';
import { fonts, space, useTheme } from '@/ui/theme';

/**
 * Web-only tab layout (browser preview / demo). On iOS the native tab bar is used
 * (`_layout.tsx`); on web NativeTabs floats over the content, so we use a classic bottom bar
 * with the coach accessory floating just above it.
 */
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'today', title: 'Hoy', icon: 'today' },
  { name: 'week', title: 'Plan', icon: 'week' },
  { name: 'me', title: 'Tú', icon: 'profile' },
];

function TabBarWithAccessory(props: BottomTabBarProps) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.bg }}>
      <View style={styles.accessory}>
        <CoachAccessory placement="regular" surface="floating" />
      </View>
      <BottomTabBar {...props} />
    </View>
  );
}

export default function TabsLayoutWeb() {
  const { colors } = useTheme();
  const { session, isLoading } = useAuth();
  if (!isLoading && !session) return <Redirect href="/" />;
  return (
    <Tabs
      tabBar={(props) => <TabBarWithAccessory {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, height: 64, paddingBottom: 8 },
        tabBarLabelStyle: { fontFamily: fonts.bodySemibold, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, size }) => <Icon name={tab.icon} size={size - 2} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  accessory: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm },
});
