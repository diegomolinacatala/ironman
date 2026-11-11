/**
 * What one Apple Salud sync brought, shared by the native implementation, the
 * web stub and the screens that tell the athlete what arrived (COROS onboarding,
 * Conexiones). Pure.
 */

export interface HealthSyncResult {
  /** Days with at least one daily value (sleep, resting HR, HRV, steps, VO2max). */
  metricsDays: number;
  /** Nights of sleep among those days. */
  sleepNights: number;
  /** Training activities found in Apple Salud in the window (new, matched or imported before). */
  activitiesFound: number;
  /** Planned workouts marked as done by an activity in this run. */
  workoutsCompleted: number;
  /** Activities added as unplanned workouts in this run. */
  activitiesImported: number;
  /** Apps that wrote the workouts and nights read ("COROS", "Connect"…): distinct, sorted. */
  sources: string[];
}

/** A fresh empty result (nothing read: Apple Salud off, unavailable or another account). */
export function emptyHealthResult(): HealthSyncResult {
  return { metricsDays: 0, sleepNights: 0, activitiesFound: 0, workoutsCompleted: 0, activitiesImported: 0, sources: [] };
}

/** Distinct, trimmed, non-empty names in alphabetical order. */
export function distinctSourceNames(names: readonly (string | null | undefined)[]): string[] {
  const unique = new Set(names.map((name) => (name ?? '').trim()).filter((name) => name.length > 0));
  return [...unique].sort((a, b) => a.localeCompare(b, 'es'));
}
