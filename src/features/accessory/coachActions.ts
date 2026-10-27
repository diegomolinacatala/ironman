import { router } from 'expo-router';
import { Platform } from 'react-native';

import { haptics } from '@/ui';

export const TALK_ROUTE = '/talk';
export const MEAL_CAMERA_ROUTE = '/meal?source=camera';

/** Mic: "Cuéntaselo a tu coach" → full-screen voice coach. */
export function openTalk(): void {
  haptics.impact();
  router.push(TALK_ROUTE);
}

/** Camera: photograph a meal → analysis sheet. */
export function openMealCamera(): void {
  haptics.impact();
  router.push(MEAL_CAMERA_ROUTE);
}

/** iOS 26+ draws the coach bar as the native tab-bar bottom accessory (Liquid Glass). */
export function hasNativeAccessory(os: string = Platform.OS, version: string | number = Platform.Version): boolean {
  if (os !== 'ios') return false;
  const major = typeof version === 'number' ? version : Number.parseInt(version, 10);
  return Number.isFinite(major) && major >= 26;
}

/**
 * Platforms without the native accessory and without the web floating bar (iOS < 26, Android)
 * show the coach bar inline on Hoy instead.
 */
export function needsInlineAccessory(os: string = Platform.OS, version: string | number = Platform.Version): boolean {
  return os !== 'web' && !hasNativeAccessory(os, version);
}
