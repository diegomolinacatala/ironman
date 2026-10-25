import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CheckinScreen from '@/app/checkin';
import type { CheckinDraft, DailyCheckin, DailyMetrics } from '@/domain/types';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockUpsert = jest.fn(async (draft: CheckinDraft): Promise<DailyCheckin> => ({ ...draft, userId: 'me' }));
const mockAdjust = jest.fn(async () => undefined);
let mockMetrics: DailyMetrics[] = [];
let mockMetricsLoading = false;

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
jest.mock('@/data/queries', () => ({
  useCheckins: () => ({ data: [], isLoading: false, error: null, refetch: jest.fn() }),
  useMetrics: () => ({ data: mockMetricsLoading ? undefined : mockMetrics, isLoading: mockMetricsLoading, error: null }),
  useUpsertCheckin: () => ({ mutateAsync: mockUpsert, isPending: false }),
}));
jest.mock('../useAdjustToday', () => ({ useAdjustToday: () => ({ run: mockAdjust, busy: false, message: null }) }));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockMetrics = [];
  mockMetricsLoading = false;
});

async function answerAll(values: { sleep: number; fatigue: number; soreness: number; stress: number; motivation: number }) {
  await fireEvent.press(screen.getByLabelText(`Calidad del sueño: ${values.sleep} de 5`));
  await fireEvent.press(screen.getByLabelText(`Fatiga: ${values.fatigue} de 5`));
  await fireEvent.press(screen.getByLabelText(`Agujetas / dolor muscular: ${values.soreness} de 5`));
  await fireEvent.press(screen.getByLabelText(`Estrés: ${values.stress} de 5`));
  await fireEvent.press(screen.getByLabelText(`Motivación: ${values.motivation} de 5`));
}

describe('check-in', () => {
  test('asks for every score before saving, right above the button', async () => {
    await render(<CheckinScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    // In the pinned footer, so it is visible even when the form is scrolled to the bottom.
    expect(within(screen.getByTestId('form-footer')).getByText(/Responde las cinco preguntas/)).toBeTruthy();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('waits for the watch metrics before showing the form', async () => {
    mockMetricsLoading = true;
    await render(<CheckinScreen />);
    expect(screen.queryByRole('button', { name: 'Guardar check-in' })).toBeNull();
    expect(screen.getByLabelText('Cargando')).toBeTruthy();
  });

  test('saves and shows the resulting readiness', async () => {
    await render(<CheckinScreen />);
    await answerAll({ sleep: 4, fatigue: 2, soreness: 2, stress: 2, motivation: 4 });
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    expect(mockUpsert.mock.calls[0]?.[0]).toMatchObject({ date: '2026-10-25', sleepQuality: 4, fatigue: 2, sleepHours: 7.5 });
    expect(await screen.findByText('Disposición de hoy')).toBeTruthy();
  });

  test('a very bad day suggests adjusting today', async () => {
    await render(<CheckinScreen />);
    await answerAll({ sleep: 1, fatigue: 5, soreness: 5, stress: 5, motivation: 1 });
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar check-in' }));
    const adjust = await screen.findByRole('button', { name: 'Ajustar hoy' });
    await fireEvent.press(adjust);
    expect(mockAdjust).toHaveBeenCalledTimes(1);
  });

  test('shows Garmin metrics with attribution', async () => {
    mockMetrics = [
      {
        userId: 'me',
        date: '2026-10-25',
        source: 'garmin',
        hrvMs: 62,
        restingHr: 48,
        sleepHours: 7.2,
        sleepScore: 81,
        bodyBattery: 70,
        trainingReadiness: null,
        vo2max: null,
        steps: null,
        stressAvg: null,
        trainingStatus: null,
      },
    ];
    await render(<CheckinScreen />);
    expect(screen.getByText('Datos de hoy · Garmin')).toBeTruthy();
    expect(screen.getByLabelText('VFC: 62 ms')).toBeTruthy();
  });
});
