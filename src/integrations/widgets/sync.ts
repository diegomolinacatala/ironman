/**
 * Widgets are iOS-only (see `sync.ios.ts`, picked by Metro on iOS). On web and
 * Android these are no-ops so the widget layouts (which import
 * `@expo/ui/swift-ui`, not web-safe) never enter those bundles.
 */
import type { ISODate, JointSession, Profile, Race, Workout } from '@/domain/types';

export interface SyncWidgetsInput {
  workouts: Workout[];
  races: Race[];
  jointSessions: JointSession[];
  profile: Profile | null;
  today: ISODate;
}

export function syncWidgets(_input: SyncWidgetsInput): void {
  // No widgets outside iOS.
}

export function resetWidgetCache(): void {
  // No widgets outside iOS.
}

export function clearWidgets(): void {
  // No widgets outside iOS.
}
