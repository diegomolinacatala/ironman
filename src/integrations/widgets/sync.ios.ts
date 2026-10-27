/**
 * iOS implementation: pushes fresh props to the widgets (expo-widgets), including the
 * "Informe de hoy" lock-screen widget (today's briefing headline).
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

import BriefingWidget from './BriefingWidget';
import NextWorkoutWidget from './NextWorkoutWidget';
import { toPropertyList } from './plist';
import { buildWidgetTimelines, linkBaseFor, type TimelineEntry, type WidgetTimelines } from './props';
import RaceWidget from './RaceWidget';
// Type-only (erased at build time): TS resolves './sync' to the shared stub's declarations.
import type { SyncWidgetsInput } from './sync';
import TodayWidget from './TodayWidget';

export type { SyncWidgetsInput } from './sync';

let lastSignature: string | null = null;

/** Native widget storage only takes property lists (see plist.ts). */
function storable<T>(entries: TimelineEntry<T>[]): TimelineEntry<T>[] {
  return entries.map((entry) => ({ date: entry.date, props: toPropertyList(entry.props) }));
}

function signatureOf(timelines: WidgetTimelines): string {
  // Dates of "now" entries change every call; compare the props and the later dates only.
  const strip = <T>(entries: { date: Date; props: T }[]) =>
    entries.map((e, i) => ({ t: i === 0 ? 0 : e.date.getTime(), p: e.props }));
  return JSON.stringify({
    a: strip(timelines.today),
    b: strip(timelines.race),
    c: strip(timelines.next),
    d: strip(timelines.briefing),
  });
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
        briefing: input.briefing,
        linkBase: linkBaseFor(Constants.expoConfig?.scheme),
      },
      new Date(),
      { today: input.today },
    );
    const signature = signatureOf(timelines);
    if (signature === lastSignature) return;
    TodayWidget.updateTimeline(storable(timelines.today));
    RaceWidget.updateTimeline(storable(timelines.race));
    NextWorkoutWidget.updateTimeline(storable(timelines.next));
    BriefingWidget.updateTimeline(storable(timelines.briefing));
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
    TodayWidget.updateSnapshot(
      toPropertyList({
        dateLabel: '',
        today: [],
        tomorrow: [],
        next: null,
        allDoneToday: false,
        week: [],
        weekPercent: 0,
        weekSummary: 'Abre Road to Ironman para cargar tu semana',
        linkBase,
      }),
    );
    RaceWidget.updateSnapshot(
      toPropertyList({
        raceName: null,
        daysToRace: null,
        raceDateLabel: '',
        distanceLabel: '',
        weekPercent: 0,
        weekLabel: '',
        linkBase,
      }),
    );
    NextWorkoutWidget.updateSnapshot(toPropertyList({ next: null, linkBase }));
    BriefingWidget.updateSnapshot(toPropertyList({ date: '', headline: '', linkBase }));
    lastSignature = null;
  } catch (error) {
    logger.warn('widgets: clear failed', error);
  }
}
