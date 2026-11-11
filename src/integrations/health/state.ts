/**
 * Device-local Apple Health integration state, per account (see `../deviceState`).
 * Shared by the native implementation, the web stub and the settings hook.
 */
import { readUserJson, writeUserJson } from '../deviceState';

const MAX_REMEMBERED_IDS = 500;
const MAX_REMEMBERED_SOURCES = 12;

export async function isHealthEnabled(userId: string): Promise<boolean> {
  return (await readUserJson<unknown>('healthEnabled', userId, false)) === true;
}

export async function setHealthEnabled(userId: string, enabled: boolean): Promise<void> {
  await writeUserJson('healthEnabled', userId, enabled);
}

export async function getHealthLastSync(userId: string): Promise<string | null> {
  const value = await readUserJson<unknown>('healthLastSync', userId, null);
  return typeof value === 'string' ? value : null;
}

export async function setHealthLastSync(userId: string, iso: string): Promise<void> {
  await writeUserJson('healthLastSync', userId, iso);
}

/** HealthKit workout UUIDs this account already handled (dedupe). */
export async function getImportedHealthIds(userId: string): Promise<Set<string>> {
  const value = await readUserJson<unknown>('healthImported', userId, []);
  return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
}

/** Remembers handled ids (most recent last, capped). */
export async function rememberImportedHealthIds(
  userId: string,
  previous: ReadonlySet<string>,
  added: readonly string[],
): Promise<void> {
  if (added.length === 0) return;
  const merged = [...previous, ...added.filter((id) => !previous.has(id))];
  await writeUserJson('healthImported', userId, merged.slice(-MAX_REMEMBERED_IDS));
}

/** Apps seen writing workouts or sleep to Apple Salud for this account ("COROS"…), most recent last. */
export async function getHealthSources(userId: string): Promise<string[]> {
  const value = await readUserJson<unknown>('healthSources', userId, []);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

/** Adds the apps seen in a sync (seen again → moved to the end, capped). Returns the merged list. */
export async function rememberHealthSources(userId: string, seen: readonly string[]): Promise<string[]> {
  const previous = await getHealthSources(userId);
  if (seen.length === 0) return previous;
  const merged = [...previous.filter((name) => !seen.includes(name)), ...seen].slice(-MAX_REMEMBERED_SOURCES);
  await writeUserJson('healthSources', userId, merged);
  return merged;
}
