import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { CalendarCard } from '@/features/settings/CalendarCard';
import { GarminCard } from '@/features/settings/GarminCard';
import { HealthCard } from '@/features/settings/HealthCard';
import { KeyboardAvoider } from '@/features/settings/KeyboardAvoider';
import { PrivacyLinkRow } from '@/features/settings/PrivacyLinkRow';
import { TrainingCalendarCard } from '@/features/settings/TrainingCalendarCard';
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
        <TrainingCalendarCard />
        <CalendarCard />
        <HealthCard />
        <PrivacyLinkRow
          title="Cómo usamos estos datos"
          subtitle={isAiCoachEnabled() ? 'Quién los ve y qué recibe el Coach IA' : 'Quién los ve y para qué los usamos'}
        />
      </Screen>
    </KeyboardAvoider>
  );
}
