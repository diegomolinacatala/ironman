/**
 * Apple Salud background delivery for sleep (wake-up briefing, best effort).
 *
 * `configureBackgroundTypes` (react-native-healthkit 16) persists the type natively and
 * registers an HKObserverQuery at every launch, so iOS can wake the app when a watch app
 * (COROS, Garmin Connect, Apple Watch) writes last night's sleep — usually when it syncs after
 * the athlete wakes up. The library holds ~25 s of background time and queues the event until
 * JS subscribes. iOS decides when (and whether) to wake the app: it is opportunistic, so the
 * server's fallback always stays in place. Needs the HealthKit background-delivery entitlement
 * (`background: true` in the config plugin, app.config.ts) and read access to sleep.
 */
import { UpdateFrequency, clearBackgroundTypes, configureBackgroundTypes, subscribeToChanges } from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';

/** Starts watching sleep writes (also in the background); returns the unsubscribe. */
export function watchSleep(onChange: () => void): () => void {
  if (Platform.OS !== 'ios') return () => undefined;
  try {
    void configureBackgroundTypes([SLEEP], UpdateFrequency.immediate).catch((error: unknown) =>
      logger.warn('health: sleep background delivery not enabled', error),
    );
    const subscription = subscribeToChanges(SLEEP, () => onChange());
    return () => {
      try {
        subscription.remove();
      } catch (error) {
        logger.warn('health: sleep unsubscribe failed', error);
      }
    };
  } catch (error) {
    logger.warn('health: sleep watch failed', error);
    return () => undefined;
  }
}

/** Stops waking the app for sleep (wake mode off, Apple Salud off, sign-out). */
export async function stopSleepWatch(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await clearBackgroundTypes();
  } catch (error) {
    logger.warn('health: sleep background delivery not cleared', error);
  }
}
