import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { IntegrationStatus } from '@/domain/types';

import { fitWithin, isSafeFileId, MEAL_PHOTO_MAX_SIDE, stripDataUrlPrefix } from '../camera/photoMath';
import {
  DEFAULT_TRAINING_SETTINGS,
  forgetTrainingCalendarId,
  getCreatedTrainingCalendarIds,
  getKnownTrainingCalendarIds,
  isTrainingCalendar,
  readTrainingSettings,
  rememberTrainingCalendarId,
  removeTrainingSettings,
  sanitizeTrainingSettings,
  trainingSettingsUserIds,
  writeTrainingSettings,
} from '../calendar/trainingCalendarStore';
import { userScopedKey } from '../deviceState';
import { GARMIN_STALE_MS, isGarminSyncDue, syncGarminIfStale } from '../effects/useGarminSync';
import { buildBriefingProps, buildWidgetProps, buildWidgetTimelines } from '../widgets/props';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('meal photo maths', () => {
  test('fits the long side into 1024 px keeping the ratio; small photos are left alone', () => {
    expect(fitWithin(4032, 3024, MEAL_PHOTO_MAX_SIDE)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3024, 4032, MEAL_PHOTO_MAX_SIDE)).toEqual({ width: 768, height: 1024 });
    expect(fitWithin(800, 600, MEAL_PHOTO_MAX_SIDE)).toBeNull();
    expect(fitWithin(0, 600, MEAL_PHOTO_MAX_SIDE)).toBeNull();
  });

  test('only uuid-like ids become file names', () => {
    expect(isSafeFileId('2f1c6a1e-0b5e-4c1f-9a0e-6f1d2c3b4a5e')).toBe(true);
    expect(isSafeFileId('../../secrets')).toBe(false);
    expect(isSafeFileId('')).toBe(false);
  });

  test('base64 loses any data: prefix', () => {
    expect(stripDataUrlPrefix('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ');
    expect(stripDataUrlPrefix('/9j/4AAQ')).toBe('/9j/4AAQ');
  });
});

describe('training calendar settings', () => {
  test('untrusted storage is sanitised with safe defaults', () => {
    expect(sanitizeTrainingSettings(null)).toEqual(DEFAULT_TRAINING_SETTINGS);
    expect(sanitizeTrainingSettings({ enabled: 'yes', alarmMinutes: -5, events: { w1: { eventId: 1 }, w2: { eventId: 'e', signature: 's' } } })).toEqual({
      ...DEFAULT_TRAINING_SETTINGS,
      alarmMinutes: 0,
      events: { w2: { eventId: 'e', signature: 's' } },
    });
    expect(sanitizeTrainingSettings({ alarmMinutes: 5000 }).alarmMinutes).toBe(1440);
  });

  test('settings are per account', async () => {
    await writeTrainingSettings('ana', { ...DEFAULT_TRAINING_SETTINGS, enabled: true, alarmMinutes: 45 });
    expect((await readTrainingSettings('ana')).enabled).toBe(true);
    expect((await readTrainingSettings('ana')).alarmMinutes).toBe(45);
    expect((await readTrainingSettings('bea')).enabled).toBe(false);
    expect(userScopedKey('trainingCalendar', 'ana')).toBe('rti.trainingCalendar.v1.user.ana');
  });

  test('our calendars are remembered by id; only the ones we created count as created', async () => {
    await rememberTrainingCalendarId('cal-1', { createdByApp: true });
    await rememberTrainingCalendarId('cal-1', { createdByApp: true });
    await rememberTrainingCalendarId('adopted', { createdByApp: false });
    expect(await getKnownTrainingCalendarIds()).toEqual(['cal-1', 'adopted']);
    expect(await getCreatedTrainingCalendarIds()).toEqual(['cal-1']);
    expect(isTrainingCalendar({ id: 'cal-1' }, ['cal-1'])).toBe(true);
    // A user's own calendar with the same title is NOT ours.
    expect(isTrainingCalendar({ id: 'x' }, ['cal-1'])).toBe(false);

    await forgetTrainingCalendarId('cal-1');
    expect(await getKnownTrainingCalendarIds()).toEqual(['adopted']);
    expect(await getCreatedTrainingCalendarIds()).toEqual([]);
  });

  test('settings can be forgotten per account and listed', async () => {
    await writeTrainingSettings('ana', { ...DEFAULT_TRAINING_SETTINGS, enabled: true, createdByApp: true });
    await writeTrainingSettings('bea', DEFAULT_TRAINING_SETTINGS);
    expect((await readTrainingSettings('ana')).createdByApp).toBe(true);
    expect((await trainingSettingsUserIds()).sort()).toEqual(['ana', 'bea']);
    await removeTrainingSettings('ana');
    expect(await trainingSettingsUserIds()).toEqual(['bea']);
    expect((await readTrainingSettings('ana')).enabled).toBe(false);
  });
});

const NOW = Date.parse('2026-10-27T08:00:00.000Z');

function garmin(overrides: Partial<IntegrationStatus>): IntegrationStatus {
  return { provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null, ...overrides };
}

describe('foreground Garmin sync', () => {
  test('due only when connected and the last sync is older than an hour (or unknown)', () => {
    expect(isGarminSyncDue([], NOW)).toBe(false);
    expect(isGarminSyncDue([garmin({ state: 'expired' })], NOW)).toBe(false);
    expect(isGarminSyncDue([garmin({ lastSyncAt: null })], NOW)).toBe(true);
    expect(isGarminSyncDue([garmin({ lastSyncAt: new Date(NOW - 30 * 60_000).toISOString() })], NOW)).toBe(false);
    expect(isGarminSyncDue([garmin({ lastSyncAt: new Date(NOW - GARMIN_STALE_MS).toISOString() })], NOW)).toBe(true);
    expect(isGarminSyncDue([garmin({ lastSyncAt: 'garbage' })], NOW)).toBe(true);
  });

  test('syncs and refreshes metrics / workouts only when due', async () => {
    const syncGarmin = jest.fn(async () => ({ metricsDays: 1, activitiesImported: 0, workoutsCompleted: 0, message: 'ok' }));
    const invalidate = jest.fn(async (_roots: readonly string[]) => undefined);
    const stale = { listIntegrations: async () => [garmin({ lastSyncAt: '2026-10-27T05:00:00.000Z' })], syncGarmin };
    const fresh = { listIntegrations: async () => [garmin({ lastSyncAt: '2026-10-27T07:50:00.000Z' })], syncGarmin };

    expect(await syncGarminIfStale(fresh, invalidate, NOW)).toBe(false);
    expect(syncGarmin).not.toHaveBeenCalled();
    expect(await syncGarminIfStale(stale, invalidate, NOW)).toBe(true);
    expect(syncGarmin).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(expect.arrayContaining(['integrations', 'metrics', 'workouts']));
  });
});

describe('briefing widget props', () => {
  const base = { workouts: [], races: [], jointSessions: [], profile: null, linkBase: 'roadtoironman://' };

  test('strings only: headline of its day, or empty strings when there is none', () => {
    expect(buildBriefingProps({ date: '2026-10-27', headline: '  Has dormido  bien ' }, 'roadtoironman://')).toEqual({
      date: '2026-10-27',
      headline: 'Has dormido bien',
      linkBase: 'roadtoironman://',
    });
    expect(buildBriefingProps(null, 'roadtoironman://')).toEqual({ date: '', headline: '', linkBase: 'roadtoironman://' });
    expect(buildBriefingProps({ date: '2026-10-27', headline: '' }, 'x://')).toEqual({ date: '', headline: '', linkBase: 'x://' });
  });

  test('bundled with the other widgets; timeline is now + next midnight', () => {
    const now = new Date(2026, 9, 27, 9, 0);
    const briefing = { date: '2026-10-27', headline: 'Hoy toca rodaje suave' };
    expect(buildWidgetProps({ ...base, briefing }, now).briefing.headline).toBe('Hoy toca rodaje suave');
    const timeline = buildWidgetTimelines({ ...base, briefing }, now).briefing;
    expect(timeline.map((e) => e.date)).toEqual([now, new Date(2026, 9, 28, 0, 0)]);
    expect(timeline.every((e) => Object.values(e.props).every((v) => typeof v === 'string'))).toBe(true);
  });
});
