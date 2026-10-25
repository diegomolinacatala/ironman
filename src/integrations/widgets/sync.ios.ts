/**
 * iOS implementation: pushes fresh props to the widgets (expo-widgets).
 * Timelines include an entry at every midnight so "Hoy" rolls over even if the
 * app is not opened. Skips the native call when nothing changed so WidgetKit's
 * reload budget is not wasted.
 *
 * Platform split: `@expo/ui/swift-ui` (imported by the widget files) requires
 * the ExpoUI native module at import time and throws on web, so the widget
 * modules are only reachable from this `.ios.ts` file; `sync.ts` is the no-op
 * used everywhere else (and for type-checking importers).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

import NextWorkoutWidget from './NextWorkoutWidget';
import { buildWidgetTimelines, linkBaseFor, type WidgetTimelines } from './props';
import RaceWidget from './RaceWidget';
// Type-only (erased at build time): TS resolves './sync' to the shared stub's declarations.
import type { SyncWidgetsInput } from './sync';
import TodayWidget from './TodayWidget';

export type { SyncWidgetsInput } from './sync';

let lastSignature: string | null = null;

function signatureOf(timelines: WidgetTimelines): string {
  // Dates of "now" entries change every call; compare the props and the later dates only.
  const strip = <T>(entries: { date: Date; props: T }[]) =>
    entries.map((e, i) => ({ t: i === 0 ? 0 : e.date.getTime(), p: e.props }));
  return JSON.stringify({ a: strip(timelines.today), b: strip(timelines.race), c: strip(timelines.next) });
}

export function syncWidgets(input: SyncWidgetsInput): void {
  if (Platform.OS !== 'ios') return;
  try {
    const timelines = buildWidgetTimelines(
      {
        workouts: input.workouts,
        races: input.races,
        jointSessions: input.jointSessions,
        profile: input.profile,
        linkBase: linkBaseFor(Constants.expoConfig?.scheme),
      },
      new Date(),
      { today: input.today },
    );
    const signature = signatureOf(timelines);
    if (signature === lastSignature) return;
    TodayWidget.updateTimeline(timelines.today);
    RaceWidget.updateTimeline(timelines.race);
    NextWorkoutWidget.updateTimeline(timelines.next);
    lastSignature = signature;
  } catch (error) {
    logger.warn('widgets: update failed', error);
  }
}

/** Forgets the last pushed state (e.g. on sign-out) so the next sync always writes. */
export function resetWidgetCache(): void {
  lastSignature = null;
}

/** Clears personal data from the widgets (sign-out). */
export function clearWidgets(): void {
  if (Platform.OS !== 'ios') return;
  try {
    const linkBase = linkBaseFor(Constants.expoConfig?.scheme);
    TodayWidget.updateSnapshot({
      dateLabel: '',
      today: [],
      tomorrow: [],
      next: null,
      allDoneToday: false,
      week: [],
      weekPercent: 0,
      weekSummary: 'Abre Rebufo para cargar tu semana',
      linkBase,
    });
    RaceWidget.updateSnapshot({
      raceName: null,
      daysToRace: null,
      raceDateLabel: '',
      distanceLabel: '',
      weekPercent: 0,
      weekLabel: '',
      linkBase,
    });
    NextWorkoutWidget.updateSnapshot({ next: null, linkBase });
    lastSignature = null;
  } catch (error) {
    logger.warn('widgets: clear failed', error);
  }
}
