/**
 * The zone-review suggestion in Progreso: shown only with a trend, links to the thresholds,
 * and «Ahora no» hides it for two weeks (stored on the device).
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProgressScreen from '@/app/(tabs)/progress';
import { todayISO } from '@/domain/dates';
import type { ReviewTrend } from '@/domain/review';
import type { ProgressData } from '@/features/progress/useProgressData';
import { isSnoozed, snoozeUntil, ZONE_REVIEW_SNOOZE_KEY } from '@/features/progress/zoneReviewSnooze';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

const TREND: ReviewTrend = {
  sport: 'run',
  sessions: 4,
  harder: 3,
  signal: 'hr',
  lastDate: '2026-10-24',
  message: 'Tus rodajes suaves van más duros de lo previsto: ¿revisamos tus zonas?',
  detail: '3 de tus últimos 4 rodajes suaves, con el pulso medio por encima de tu zona.',
  advice: 'Si tu pulso de umbral ha cambiado, actualízalo; si no, frena un poco en los días suaves.',
};

jest.setTimeout(60000);

let mockData: ProgressData;
jest.mock('@/features/progress/useProgressData', () => ({ useProgressData: () => mockData }));
// The threshold suggestion has its own tests (features/thresholds) and reads the repository.
jest.mock('@/features/thresholds/ThresholdSuggestions', () => ({ ThresholdSuggestions: () => null }));

function progressData(zoneTrend: ReviewTrend | null): ProgressData {
  return {
    pmc: null,
    volume: [],
    recovery: [],
    race: null,
    phase: null,
    zoneTrend,
    nutrition: null,
    isLoading: true,
    error: null,
    isRefetching: false,
    refetch: () => undefined,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('snooze dates', () => {
  test('«Ahora no» hides it for 14 days; a malformed or missing date never hides it', () => {
    expect(snoozeUntil('2026-11-26')).toBe('2026-12-10');
    expect(isSnoozed('2026-12-10', '2026-12-09')).toBe(true);
    expect(isSnoozed('2026-12-10', '2026-12-10')).toBe(false);
    expect(isSnoozed(null, '2026-11-26')).toBe(false);
    expect(isSnoozed('mañana', '2026-11-26')).toBe(false);
  });
});

describe('zone-review card in Progreso', () => {
  test('no trend, no card', async () => {
    mockData = progressData(null);
    await render(<ProgressScreen />);
    await waitFor(() => expect(screen.getByText('Progreso')).toBeTruthy());
    expect(screen.queryByText(/revisamos tus zonas/)).toBeNull();
  });

  test('with a trend: the message, its reason, and a link to the thresholds', async () => {
    mockData = progressData(TREND);
    await render(<ProgressScreen />);
    expect(await screen.findByText(TREND.message)).toBeTruthy();
    expect(screen.getByText(`${TREND.detail} ${TREND.advice}`)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar mis umbrales' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/profile');
  });

  test('«Ahora no» hides it and stores the date two weeks ahead', async () => {
    mockData = progressData(TREND);
    await render(<ProgressScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
    expect(screen.queryByText(TREND.message)).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem(ZONE_REVIEW_SNOOZE_KEY)).toBe(snoozeUntil(todayISO())));
  });

  test('stays hidden while snoozed and comes back after', async () => {
    mockData = progressData(TREND);
    await AsyncStorage.setItem(ZONE_REVIEW_SNOOZE_KEY, snoozeUntil(todayISO()));
    const first = await render(<ProgressScreen />);
    await waitFor(() => expect(screen.getByText('Progreso')).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(TREND.message)).toBeNull();
    await first.unmount();

    await AsyncStorage.setItem(ZONE_REVIEW_SNOOZE_KEY, todayISO());
    await render(<ProgressScreen />);
    expect(await screen.findByText(TREND.message)).toBeTruthy();
  });
});
