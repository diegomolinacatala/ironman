import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { ISODate } from '@/domain/types';
import { Card, Text, haptics, space } from '@/ui';

import {
  BriefingError,
  BriefingSkeleton,
  CardOverline,
  ConnectGarminBody,
  EmptyBody,
  ListenControls,
} from './BriefingCardStates';
import { SleepFacts } from './SleepFacts';
import { useBriefingController } from './useBriefingController';
import { useBriefingPlayer } from './useBriefingPlayer';
import { useRotatingStep } from './useRotatingStep';

export const INTEGRATIONS_ROUTE = '/settings/integrations';

/**
 * "Informe de hoy" hero card on Hoy: headline + last night + ▶ Escuchar, or the way to get one
 * (prepare it, or connect Garmin first).
 */
export function BriefingCard({ date }: { date: ISODate }) {
  const ctrl = useBriefingController(date);
  const player = useBriefingPlayer();
  const step = useRotatingStep(ctrl.state === 'generating', ctrl.steps.length);
  const { briefing } = ctrl;

  const prepare = () => {
    haptics.impact();
    void ctrl.generate();
  };

  return (
    <Card variant="raised" padding="lg" style={styles.card}>
      <CardOverline engine={briefing?.engine} />
      {ctrl.state === 'ready' && briefing ? (
        <>
          <View style={styles.text}>
            <Text variant="title" accessibilityRole="header">
              {briefing.headline}
            </Text>
            {briefing.sleepSummary ? (
              <Text variant="callout" color="textMuted">
                {briefing.sleepSummary}
              </Text>
            ) : null}
          </View>
          <SleepFacts sleep={briefing.sleep} />
          <ListenControls
            script={briefing.script}
            mode={player.mode}
            progress={player.progress}
            onToggle={() => player.toggle(briefing.script)}
            onOpen={() => router.push('/briefing')}
          />
        </>
      ) : null}
      {ctrl.state === 'loading' ? <BriefingSkeleton /> : null}
      {ctrl.state === 'generating' ? <BriefingSkeleton message={ctrl.steps[step]} /> : null}
      {ctrl.state === 'error' ? <BriefingError error={ctrl.error} onRetry={ctrl.retry} /> : null}
      {ctrl.state === 'empty' ? <EmptyBody onPrepare={prepare} /> : null}
      {ctrl.state === 'connect-garmin' ? (
        <ConnectGarminBody
          expired={ctrl.garmin === 'expired'}
          onConnect={() => router.push(INTEGRATIONS_ROUTE)}
          onSkip={ctrl.skipGarmin}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  text: { gap: space.sm },
});
