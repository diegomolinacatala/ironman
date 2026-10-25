/**
 * Helpers for demo repository tests (not a test file itself: no `.test.`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createDemoRepository, type DemoRepository } from '../demo/DemoRepository';
import type { ChangeTopic } from '../repository';

/** Sunday 25 Oct 2026, 10:00 local time. */
export const SUNDAY = new Date(2026, 9, 25, 10, 0, 0);
/** Wednesday 21 Oct 2026, 10:00 local time. */
export const WEDNESDAY = new Date(2026, 9, 21, 10, 0, 0);

export async function signedInRepo(now: Date = SUNDAY, friendDelayMs = 30): Promise<DemoRepository> {
  const repo = createDemoRepository({ now: () => now, persistDebounceMs: 0, friendDelayMs });
  await repo.auth.verifyEmailCode('diego@example.com', '123456');
  return repo;
}

export async function resetStorage(): Promise<void> {
  await AsyncStorage.clear();
}

export function waitForTopic(repo: DemoRepository, topic: ChangeTopic, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timeout waiting for ${topic}`));
    }, timeoutMs);
    const unsubscribe = repo.subscribe((t) => {
      if (t !== topic) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}
