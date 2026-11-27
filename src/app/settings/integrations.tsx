import { useLocalSearchParams } from 'expo-router';

import { useProfile } from '@/data/queries';
import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { CalendarCard } from '@/features/settings/CalendarCard';
import { CorosCard } from '@/features/settings/CorosCard';
import { CorosDirectCard } from '@/features/settings/CorosDirectCard';
import { GarminCard } from '@/features/settings/GarminCard';
import { HealthCard } from '@/features/settings/HealthCard';
import { KeyboardAvoider } from '@/features/settings/KeyboardAvoider';
import { PrivacyLinkRow } from '@/features/settings/PrivacyLinkRow';
import { TrainingCalendarCard } from '@/features/settings/TrainingCalendarCard';
import { useWatchBrand } from '@/features/settings/useWatchBrand';
import { WatchBrandPicker } from '@/features/settings/WatchBrandPicker';
import { Card, Loading, Screen, Text } from '@/ui';

/** Conexiones: your watch (Garmin | COROS) first, then the calendars and Apple Salud. */
export default function IntegrationsScreen() {
  const profile = useProfile();
  const watch = useWatchBrand(profile.data);
  const coros = watch.brand === 'coros';
  // roadtoironman://settings/integrations?coros=connected|error&reason=… after the COROS authorization.
  const params = useLocalSearchParams<{ coros?: string; reason?: string }>();
  const corosReturn = params.coros ? `?coros=${params.coros}${params.reason ? `&reason=${params.reason}` : ''}` : null;

  if (profile.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando tus conexiones" />
      </Screen>
    );
  }

  return (
    // The Garmin key field must stay above the keyboard.
    <KeyboardAvoider>
      <Screen inSheet>
        <Text variant="callout" color="textMuted">
          Cuantos más datos reales, mejor encaja el plan: lo que hiciste, cómo dormiste y cuándo estás ocupado.
        </Text>
        <Card padding="md">
          <WatchBrandPicker choice={watch} />
        </Card>
        {coros ? (
          <>
            <CorosDirectCard returnUrl={corosReturn} />
            <CorosCard />
          </>
        ) : (
          <GarminCard />
        )}
        <TrainingCalendarCard />
        <CalendarCard />
        {/* With COROS, Apple Salud is the watch connection itself (the COROS card). */}
        {coros ? null : <HealthCard />}
        <PrivacyLinkRow
          title="Cómo usamos estos datos"
          subtitle={isAiCoachEnabled() ? 'Quién los ve y qué recibe el Coach IA' : 'Quién los ve y para qué los usamos'}
        />
      </Screen>
    </KeyboardAvoider>
  );
}
