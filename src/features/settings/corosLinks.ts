import { router } from 'expo-router';
import { Linking } from 'react-native';

import { logger } from '@/lib/logger';

import { COROS_APP_URL, COROS_GUIDE_ROUTE } from './corosContent';

/** Opens COROS in the App Store («Abrir» when installed). False when it could not be opened. */
export async function openCorosApp(): Promise<boolean> {
  try {
    await Linking.openURL(COROS_APP_URL);
    return true;
  } catch (error) {
    logger.warn('coros: open app failed', error);
    return false;
  }
}

/** The complete guide ("Conectar COROS"). */
export function openCorosGuide(): void {
  router.push(COROS_GUIDE_ROUTE);
}
