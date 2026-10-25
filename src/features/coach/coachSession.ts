/**
 * The app-wide coach store, persisted to the device (`StorageKeys.coachHistory`).
 */
import { StorageKeys, readJson, removeKey, writeJson } from '@/lib/storage';

import { createCoachStore } from './coachStore';

export const coachStore = createCoachStore({
  read: () => readJson<unknown>(StorageKeys.coachHistory, null),
  write: (value) => writeJson(StorageKeys.coachHistory, value),
  remove: () => removeKey(StorageKeys.coachHistory),
});
