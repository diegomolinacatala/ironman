/**
 * In release builds React Native turns an uncaught JS error into a native abort (RCTFatal) and the
 * crash report carries no message, so a launch bug is a black box (TestFlight build 4). Instead,
 * a fatal error in release shows an alert with the message and the top of the stack, which a
 * tester can screenshot. Development builds keep React Native's red box.
 */
import { Alert } from 'react-native';

import { logger } from './logger';

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

/** The part of React Native's `ErrorUtils` global used here. */
export interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}

const STACK_LINES = 8;

export function describeFatal(error: unknown): string {
  if (error instanceof Error) {
    const frames = (error.stack ?? '')
      .split('\n')
      .filter((line) => line.trim().startsWith('at '))
      .slice(0, STACK_LINES)
      .map((line) => line.trim());
    return [error.message || error.name, ...frames].join('\n');
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function installFatalErrorAlert(
  errorUtils: ErrorUtilsLike | undefined = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils,
  isDev: boolean = typeof __DEV__ !== 'undefined' && __DEV__,
): void {
  if (!errorUtils || isDev) return;
  const previous = errorUtils.getGlobalHandler();
  let shown = false;
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    logger.error('fatal JS error', error);
    if (shown) return;
    shown = true;
    Alert.alert('Road to Ironman ha fallado', `${describeFatal(error)}\n\nHaz una captura y envíasela a Diego.`);
  });
}
