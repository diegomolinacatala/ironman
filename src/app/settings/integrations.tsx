import { CalendarCard } from '@/features/settings/CalendarCard';
import { GarminCard } from '@/features/settings/GarminCard';
import { HealthCard } from '@/features/settings/HealthCard';
import { KeyboardAvoider } from '@/features/settings/KeyboardAvoider';
import { PrivacyLinkRow } from '@/features/settings/PrivacyLinkRow';
import { Screen, Text } from '@/ui';

export default function IntegrationsScreen() {
  return (
    // The Garmin key field must stay above the keyboard.
    <KeyboardAvoider>
      <Screen inSheet>
        <Text variant="callout" color="textMuted">
          Cuantos más datos reales, mejor encaja el plan: lo que hiciste, cómo dormiste y cuándo estás ocupado.
        </Text>
        <GarminCard />
        <HealthCard />
        <CalendarCard />
        <PrivacyLinkRow title="Cómo usamos estos datos" subtitle="Quién los ve y qué recibe el Coach IA" />
      </Screen>
    </KeyboardAvoider>
  );
}
