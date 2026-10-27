import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';

import { useAuth } from '@/data/context';
import { NativeCoachAccessory } from '@/features/accessory/NativeCoachAccessory';
import { useTheme } from '@/ui/theme';

/**
 * v2: three tabs (Hoy, Plan, Tú) + the coach accessory (iOS 26 bottom accessory: talk to the
 * coach / photograph a meal). Juntos and Progreso live in the root stack (linked from Tú).
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { session, isLoading } = useAuth();
  if (!isLoading && !session) return <Redirect href="/" />;
  return (
    <NativeTabs
      backgroundColor={colors.bg}
      indicatorColor={colors.surfaceAlt}
      tintColor={colors.text}
      labelStyle={{ selected: { color: colors.text } }}
      minimizeBehavior="onScrollDown">
      <NativeTabs.BottomAccessory>
        <NativeCoachAccessory />
      </NativeTabs.BottomAccessory>
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Label>Hoy</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} md="wb_sunny" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="week">
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="me">
        <NativeTabs.Trigger.Label>Tú</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
