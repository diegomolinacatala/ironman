import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import EventEditScreen from '@/app/event/edit';
import type { LifeEvent, LifeEventDraft } from '@/domain/types';
import { makeEvent } from '@/features/workouts/__tests__/fixtures';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockCreate = jest.fn(async (draft: LifeEventDraft): Promise<LifeEvent> => makeEvent({ ...draft, id: 'new-1', endDate: draft.endDate ?? draft.startDate, startTime: draft.startTime ?? null, durationMin: draft.durationMin ?? null, bodyArea: draft.bodyArea ?? null, notes: draft.notes ?? null }));
const mockRun = jest.fn(async () => undefined);
let mockParams: Record<string, string> = {};
let mockEvents: LifeEvent[] = [];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/queries', () => ({
  useLifeEvents: () => ({ data: mockEvents, isLoading: false, error: null, refetch: jest.fn() }),
  useCreateLifeEvent: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateLifeEvent: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteLifeEvent: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('../useReplanForEvent', () => ({
  useReplanForEvent: () => ({ run: mockRun, busy: false, ready: true, message: null }),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { date: '2026-10-28' };
  mockEvents = [];
});

describe('Ha surgido algo', () => {
  test('saves a padel match and offers to re-plan', async () => {
    await render(<EventEditScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar imprevisto' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({ kind: 'padel', startDate: '2026-10-28', endDate: '2026-10-28', durationMin: 90 });
    expect(await screen.findByText('¿Reorganizamos tu semana?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reorganizar (reglas)' }));
    expect(mockRun).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Pedir al coach IA' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/coach?mode=replan&lifeEventId=new-1');
  });

  test('injury requires a body area', async () => {
    await render(<EventEditScreen />);
    await fireEvent.press(screen.getAllByLabelText(/Lesi/)[0]!);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar imprevisto' }));
    // Shown next to the pinned button, not at the top of a long form.
    expect(await within(screen.getByTestId('form-footer')).findByText('Indica la zona del cuerpo')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('editing an unknown id shows the empty state', async () => {
    mockParams = { id: 'missing' };
    await render(<EventEditScreen />);
    expect(screen.getByText('No encontramos este imprevisto')).toBeTruthy();
  });

  test('editing loads the existing event', async () => {
    mockParams = { id: 'e1', date: '2026-10-28' };
    mockEvents = [makeEvent({ title: 'Final de pádel' })];
    await render(<EventEditScreen />);
    expect(screen.getByDisplayValue('Final de pádel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Borrar imprevisto' })).toBeTruthy();
  });
});
