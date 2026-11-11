import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { CompletedData, Workout } from '@/domain/types';

import { CompleteSheet } from '../CompleteSheet';
import { makeWorkout } from './fixtures';

const mockComplete = jest.fn(
  async (vars: { id: string; data: CompletedData }): Promise<Workout> =>
    makeWorkout({ id: vars.id, status: 'completed', completed: vars.data }),
);

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/queries', () => ({
  useCompleteWorkout: () => ({ mutateAsync: mockComplete, isPending: false, error: null }),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CompleteSheet', () => {
  test('asks for sensaciones and saves them as completed.feel with the RPE', async () => {
    const onClose = jest.fn();
    const onDone = jest.fn();
    await render(<CompleteSheet workout={makeWorkout({ durationMin: 45 })} visible onClose={onClose} onDone={onDone} />);
    expect(screen.getByText('Previsto: RPE 3–4')).toBeTruthy();
    expect(screen.getByText('Cómo te has notado, más allá del esfuerzo.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '4' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Bien' }));
    expect(screen.getByText('Te has sentido: bien')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar como hecho' }));
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockComplete.mock.calls[0]?.[0].data).toMatchObject({ durationMin: 45, rpe: 4, feel: 4, source: 'manual' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('sensaciones are optional; strength shows its planned effort', async () => {
    await render(<CompleteSheet workout={makeWorkout({ sport: 'strength', durationMin: 40 })} visible onClose={() => undefined} />);
    expect(screen.getByText('Previsto: RPE 6–7')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar como hecho' }));
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockComplete.mock.calls[0]?.[0].data).not.toHaveProperty('feel');
  });

  test('a previously saved feel is preselected', async () => {
    const done = makeWorkout({ status: 'completed', completed: { durationMin: 40, feel: 2 } });
    await render(<CompleteSheet workout={done} visible onClose={() => undefined} />);
    expect(screen.getByText('Te has sentido: mal')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mal' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});
