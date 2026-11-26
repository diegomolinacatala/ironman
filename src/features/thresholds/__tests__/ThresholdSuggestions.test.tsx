import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { Profile, ProfilePatch, Workout } from '@/domain/types';
import { makeProfile, makeWorkout } from '@/domain/__tests__/fixtures';

import { ThresholdSuggestions } from '../ThresholdSuggestions';

const TODAY = '2026-11-26';
const mockUpdate = jest.fn(async (_patch: ProfilePatch) => ({}) as Profile);
const mockWrite = jest.fn(async (_key: string, _value: unknown) => undefined);
let mockStored: Record<string, string> = {};
const mockProfile = makeProfile({ thresholds: { runThresholdPaceSecPerKm: 280, lthr: 170, ftpW: 230 } });
const mockWorkouts: Workout[] = [
  makeWorkout({
    id: 'r1',
    date: '2026-11-12',
    sport: 'run',
    status: 'completed',
    completed: { durationMin: 44.17, distanceM: 10000, avgHr: 168 },
  }),
];

jest.mock('@/data/queries', () => ({
  useProfile: () => ({ data: mockProfile }),
  useWorkouts: () => ({ data: mockWorkouts }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));
jest.mock('@/lib/storage', () => ({
  StorageKeys: { thresholdSnoozes: 'snoozes' },
  readJson: async () => mockStored,
  writeJson: (key: string, value: unknown) => mockWrite(key, value),
}));

const MESSAGE = 'Tu umbral de carrera parece haber mejorado a 4:30/km (antes 4:40). ¿Lo actualizo?';

beforeEach(() => {
  jest.clearAllMocks();
  mockStored = {};
});

describe('ThresholdSuggestions', () => {
  test('shows the suggestion with its evidence; «Actualizar» saves only that threshold', async () => {
    await render(<ThresholdSuggestions today={TODAY} />);
    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    expect(screen.getByText('Por tu carrera del 12 nov: 10,0 km a 4:25/km con 168 ppm de media.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Actualizar' }));
    expect(mockUpdate).toHaveBeenCalledWith({ thresholds: { runThresholdPaceSecPerKm: 270, lthr: 170, ftpW: 230 } });
  });

  test('«Ahora no» hides it and remembers the date on the device', async () => {
    await render(<ThresholdSuggestions today={TODAY} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
    await waitFor(() => expect(screen.queryByText(MESSAGE)).toBeNull());
    expect(mockWrite).toHaveBeenCalledWith('snoozes', { runThresholdPaceSecPerKm: TODAY });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a recent «Ahora no» keeps it hidden', async () => {
    mockStored = { runThresholdPaceSecPerKm: '2026-11-20' } as Record<string, string>;
    await render(<ThresholdSuggestions today={TODAY} />);
    await waitFor(() => expect(screen.queryByText(MESSAGE)).toBeNull());
  });
});
