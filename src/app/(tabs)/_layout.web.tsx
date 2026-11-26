import { Redirect, Tabs } from 'expo-router';

import { useAuth } from '@/data/context';
import { Icon, type IconName } from '@/ui/Icon';
import { fonts, useTheme } from '@/ui/theme';
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'today', title: 'Hoy', icon: 'today' },
  { name: 'week', title: 'Plan', icon: 'week' },
  { name: 'together', title: 'Juntos', icon: 'together' },
  { name: 'progress', title: 'Progreso', icon: 'progress' },
  { name: 'me', title: 'Tú', icon: 'profile' },
];

export default function TabsLayoutWeb() {
  const { colors } = useTheme();
  const { session, isLoading } = useAuth();
  if (!isLoading && !session) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentInk,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingBottom: 8 },
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

