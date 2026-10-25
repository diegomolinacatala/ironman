/**
 * Check-in against the real query hooks and a fake repository, so a save
 * triggers the same refetch as in the app (the mocked-hooks suite cannot).
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import CheckinScreen from '@/app/checkin';
import { AuthContext, RepositoryContext } from '@/data/context';
import type { Repository } from '@/data/repository';
import type { CheckinDraft, DailyCheckin, DailyMetrics } from '@/domain/types';

const DATE = '2026-10-25';
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockAdjust = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ date: '2026-10-25' }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('../useAdjustToday', () => ({ useAdjustToday: () => ({ run: mockAdjust, busy: false, message: null }) }));

jest.setTimeout(30000);

function metricsRow(overrides: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    userId: 'me',
    date: DATE,
    source: 'garmin',
    hrvMs: null,
    restingHr: null,
    sleepHours: null,
    sleepScore: null,
    bodyBattery: null,
    trainingReadiness: null,
    vo2max: null,
    steps: null,
    stressAvg: null,
    trainingStatus: null,
    ...overrides,
  };
}

function makeRepo(opts: { metrics?: DailyMetrics[]; metricsDelayMs?: number } = {}) {
  let stored: DailyCheckin[] = [];
  return {
    mode: 'demo',
    auth: {},
    listCheckins: jest.fn(async () => stored),
    upsertCheckin: jest.fn(async (draft: CheckinDraft): Promise<DailyCheckin> => {
      const saved: DailyCheckin = { ...draft, userId: 'me' };
      stored = [saved];
      return saved;
    }),
    listMetrics: jest.fn(
      () => new Promise<DailyMetrics[]>((resolve) => setTimeout(() => resolve(opts.metrics ?? []), opts.metricsDelayMs ?? 0)),
    ),
    subscribe: jest.fn(() => () => undefined),
  };
}

let repo = makeRepo();

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  return (
    <RepositoryContext.Provider value={repo as unknown as Repository}>
      <AuthContext.Provider value={{ session: { userId: 'me', email: null }, isLoading: false }}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    </RepositoryContext.Provider>
  );
}

async function answerAll(values: [number, number, number, number, number]) {
  const [sleep, fatigue, soreness, stress, motivation] = values;
  await fireEvent.press(screen.getByLabelText(`Calidad del sueño: ${sleep} de 5`));
  await fireEvent.press(screen.getByLabelText(`Fatiga: ${fatigue} de 5`));
  await fireEvent.press(screen.getByLabelText(`Agujetas / dolor muscular: ${soreness} de 5`));
  await fireEvent.press(screen.getByLabelText(`Estrés: ${stress} de 5`));
  await fireEvent.press(screen.getByLabelText(`Motivación: ${motivation} de 5`));
}

beforeEach(() => {
  jest.clearAllMocks();
  repo = makeRepo();
});

describe('first check-in of the day', () => {
  test('keeps the readiness result after the save refetches the day', async () => {
    await render(<CheckinScreen />, { wrapper: Providers });
    await screen.findByRole('button', { name: 'Guardar check-in' });
    await answerAll([4, 2, 2, 2, 4]);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    expect(await screen.findByText('Disposición de hoy')).toBeTruthy();
    // The refetch returned the saved row (new → edit) and the editor was not remounted.
    expect(repo.listCheckins.mock.calls.length).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: 'Guardar check-in' })).toBeNull();
  });

  test('a red day offers "Ajustar hoy" on the first save', async () => {
    await render(<CheckinScreen />, { wrapper: Providers });
    await screen.findByRole('button', { name: 'Guardar check-in' });
    await answerAll([1, 5, 5, 5, 1]);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Ajustar hoy' }));
    expect(mockAdjust).toHaveBeenCalledTimes(1);
  });

  test('uses the watch sleep hours even when metrics arrive after the check-ins', async () => {
    repo = makeRepo({ metrics: [metricsRow({ sleepHours: 5.5 })], metricsDelayMs: 150 });
    await render(<CheckinScreen />, { wrapper: Providers });
    await screen.findByRole('button', { name: 'Guardar check-in' });
    expect(screen.queryByText('7,5 h')).toBeNull();
    await answerAll([3, 3, 3, 3, 3]);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    await waitFor(() => expect(repo.upsertCheckin).toHaveBeenCalledTimes(1));
    expect(repo.upsertCheckin.mock.calls[0]?.[0]).toMatchObject({ date: DATE, sleepHours: 5.5 });
  });

  test('a failed refetch after saving does not replace the result with an error', async () => {
    await render(<CheckinScreen />, { wrapper: Providers });
    await screen.findByRole('button', { name: 'Guardar check-in' });
    repo.listCheckins.mockRejectedValue(new Error('Sin conexión'));
    await answerAll([4, 2, 2, 2, 4]);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    expect(await screen.findByText('Disposición de hoy')).toBeTruthy();
    expect(screen.queryByText('Sin conexión')).toBeNull();
  });

  test('a failed save is shown above the button', async () => {
    repo.upsertCheckin.mockRejectedValueOnce(new Error('Sin conexión'));
    await render(<CheckinScreen />, { wrapper: Providers });
    await screen.findByRole('button', { name: 'Guardar check-in' });
    await answerAll([4, 2, 2, 2, 4]);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    expect(await within(screen.getByTestId('form-footer')).findByText('Sin conexión')).toBeTruthy();
  });
});
