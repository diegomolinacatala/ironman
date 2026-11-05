import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';

import { useAuth } from '@/data/context';
import { NativeCoachAccessory } from '@/features/accessory/NativeCoachAccessory';
import { useTheme } from '@/ui/theme';

/**
 * Five tabs — Hoy · Plan · Juntos · Progreso · Tú — plus the coach accessory (iOS 26 bottom
 * accessory: talk to the coach / photograph a meal). Tú is the settings hub; every feature has
 * its own top-level place instead of hiding behind "Más".
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { session, isLoading } = useAuth();
  if (!isLoading && !session) return <Redirect href="/" />;
  return (
    <NativeTabs
      backgroundColor={colors.bg}
      indicatorColor={colors.accentSoft}
      tintColor={colors.accentInk}
      labelStyle={{ selected: { color: colors.accentInk } }}
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
      <NativeTabs.Trigger name="together">
        <NativeTabs.Trigger.Label>Juntos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="progress">
        <NativeTabs.Trigger.Label>Progreso</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" md="monitoring" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="me">
        <NativeTabs.Trigger.Label>Tú</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
