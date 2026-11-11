import { StyleSheet } from 'react-native';

import type { Profile } from '@/domain/types';
import { useWatchBrand, type WatchBrandChoice } from '@/features/settings/useWatchBrand';
import { WATCH_BRAND_OPTIONS } from '@/features/settings/watchBrand';
import { ErrorNotice, Segmented, space } from '@/ui';

import { Appear } from '../Appear';
import { watchStepTitle } from '../onboardingModel';
import type { StepNav } from '../StepLayout';
import { CorosStep } from './CorosStep';
import { GarminStep } from './GarminStep';

export interface WatchStepProps {
  nav: StepNav;
  profile: Pick<Profile, 'watchBrand'>;
  isDemo: boolean;
  /** Skipped before (the athlete came back): the way out is offered right away. */
  skipped: boolean;
  /** "Seguir sin reloj" (or the web demo's simulated COROS): the flow records it and moves on. */
  onSkip: () => void;
}

/**
 * Step 3 "Tu reloj" (required): Garmin | COROS, saved to the profile as soon as it is chosen,
 * then that watch's guide. Garmin: the Personal API key, as always. COROS: Apple Salud.
 */
export function WatchStep({ nav, profile, isDemo, skipped, onSkip }: WatchStepProps) {
  const choice = useWatchBrand(profile);
  const title = watchStepTitle(choice.brand);
  const picker = <WatchPicker choice={choice} />;
  if (choice.brand === 'coros') {
    return <CorosStep nav={nav} isDemo={isDemo} skipped={skipped} onSkip={onSkip} onSimulatedDone={onSkip} picker={picker} title={title} />;
  }
  return <GarminStep nav={nav} isDemo={isDemo} skipped={skipped} onSkip={onSkip} picker={picker} title={title} />;
}

function WatchPicker({ choice }: { choice: WatchBrandChoice }) {
  return (
    <Appear index={1} style={styles.picker}>
      <Segmented accessibilityLabel="Tu reloj" options={WATCH_BRAND_OPTIONS} value={choice.brand} onChange={(brand) => void choice.choose(brand)} />
      {choice.error ? <ErrorNotice message={choice.error} /> : null}
    </Appear>
  );
}

const styles = StyleSheet.create({
  picker: { gap: space.sm },
});
