import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import WorkoutDetailScreen from '@/app/workout/[id]';
import { addDays, todayISO } from '@/domain/dates';
import type { Thresholds, Workout, WorkoutPatch, WorkoutStep } from '@/domain/types';
import type { CoachVerdictModel } from '@/features/workouts/coachAdapters';
import { HR_HINT_TEXT } from '@/features/workouts/detail/ThresholdsHint';

import { ME, makeWorkout } from './fixtures';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockRedirect = jest.fn((_href: string) => null);
const mockActions = {
  moveTo: jest.fn(async (_w: Workout, _date: string) => true),
  moveToTomorrow: jest.fn(async (_w: Workout) => true),
  duplicate: jest.fn(async (_w: Workout) => null),
  remove: jest.fn(async (_w: Workout) => true),
  skip: jest.fn(async (_w: Workout) => true),
  reset: jest.fn(async (_w: Workout) => true),
  invite: jest.fn((_w: Workout) => undefined),
  easier: jest.fn(async (_w: Workout, _patch: WorkoutPatch) => true),
  busy: false,
};
const mockEasierPatch = jest.fn((_w: Workout, _t: Thresholds | null): WorkoutPatch | null => null);
const mockVerdict = jest.fn((_w: Workout, _t: Thresholds | null, _r: unknown): CoachVerdictModel | null => null);
let mockAuth = { session: { userId: ME, email: null } as { userId: string; email: string | null } | null, isLoading: false };
let mockWorkout: { data: Workout | null | undefined; isLoading: boolean } = { data: undefined, isLoading: false };
let mockThresholds: Thresholds | null = null;

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Redirect: ({ href }: { href: string }) => mockRedirect(href),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'w1' }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));
jest.mock('@/data/context', () => ({ useAuth: () => mockAuth }));
jest.mock('@/data/queries', () => ({
  useWorkout: () => ({ ...mockWorkout, error: null, refetch: jest.fn(), isRefetching: false }),
  useJointSession: () => ({ data: null, isLoading: false, error: null }),
  useProfile: () => ({ data: { thresholds: mockThresholds } }),
  useRaces: () => ({ data: [] }),
  useCompleteWorkout: () => ({ mutateAsync: jest.fn(), isPending: false, error: null }),
}));
jest.mock('@/features/workouts/useWorkoutActions', () => ({ useWorkoutActions: () => mockActions }));
// The coach's rules (domain/planB, domain/review) are unit-tested on their own: the screen only wires them.
jest.mock('@/features/workouts/coachAdapters', () => ({
  easierPatch: (w: Workout, t: Thresholds | null) => mockEasierPatch(w, t),
  workoutVerdict: (w: Workout, t: Thresholds | null, r: unknown) => mockVerdict(w, t, r),
}));

jest.setTimeout(30000);

const STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15 },
  { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Fuerte pero controlado' },
  { kind: 'recovery', durationMin: 2, repeat: 3 },
  { kind: 'cooldown', durationMin: 10 },
];
const COACHING = {
  objective: 'Subir tu umbral sin pasarte',
  keys: ['Las tres series al mismo ritmo', 'Recupera trotando'],
  success: 'Terminas la última serie con una más en las piernas',
  planB: "Rodaje suave de 40'",
};
const EASIER: WorkoutPatch = { title: 'Rodaje suave', durationMin: 40, intensity: 'endurance', steps: [] };

function series(overrides: Partial<Workout> = {}): Workout {
  return makeWorkout({
    id: 'w1',
    date: todayISO(),
    title: 'Series 3×8',
    intensity: 'threshold',
    durationMin: 60,
    steps: STEPS,
    coaching: COACHING,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  mockAuth = { session: { userId: ME, email: null }, isLoading: false };
  mockWorkout = { data: undefined, isLoading: false };
  mockThresholds = { lthr: 170, runThresholdPaceSecPerKm: 270 };
  mockEasierPatch.mockReturnValue(null);
  mockVerdict.mockReturnValue(null);
});

describe('workout detail', () => {
  test('waits for the session instead of flashing "no encontrado" (cold-start widget link)', async () => {
    mockAuth = { session: null, isLoading: true };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText('Entreno no encontrado')).toBeNull();
    expect(screen.getByLabelText('Cargando entreno')).toBeTruthy();
  });

  test('signed out sends the user through the entry gate', async () => {
    mockAuth = { session: null, isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  test('not found with no back stack offers a way to Hoy', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    mockWorkout = { data: null, isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText('Entreno no encontrado')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/today');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('deleting with no back stack lands on Hoy', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    mockWorkout = { data: makeWorkout({ id: 'w1' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(mockActions.remove).toHaveBeenCalledTimes(1);
  });

  test('deleting goes back when there is a previous screen', async () => {
    mockWorkout = { data: makeWorkout({ id: 'w1' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('workout detail · the coach’s prescription', () => {
  test('objective, keys, main target, one row per step, success and plan B', async () => {
    mockWorkout = { data: series(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText('Objetivo')).toBeTruthy();
    expect(screen.getByText('Subir tu umbral sin pasarte')).toBeTruthy();
    expect(screen.getByText('Claves')).toBeTruthy();
    expect(screen.getByText('Recupera trotando')).toBeTruthy();
    expect(screen.getByLabelText("Zona objetivo: 162–168 ppm, 3×8' Z4 · 4:27–4:44 /km · RPE 7–8")).toBeTruthy();
    expect(screen.getByText('Carga')).toBeTruthy();
    expect(screen.queryByText(/TSS/)).toBeNull();
    expect(screen.getByText('Estructura')).toBeTruthy();
    expect(screen.getByLabelText("3×8' Series. Zona Z4. 162–168 ppm, 4:27–4:44 /km, RPE 7–8. Fuerte pero controlado.")).toBeTruthy();
    expect(screen.getByLabelText(/^15' Calentamiento\. Zona Z1\. 128–143 ppm/)).toBeTruthy();
    expect(screen.getByText('Lo has hecho bien si…')).toBeTruthy();
    expect(screen.getByText('Terminas la última serie con una más en las piernas')).toBeTruthy();
    expect(screen.getByText('Si no es tu día')).toBeTruthy();
    expect(screen.getByText("Rodaje suave de 40'")).toBeTruthy();
    expect(screen.queryByLabelText(HR_HINT_TEXT)).toBeNull();
  });

  test('"Hacer la versión suave" applies the easier version through the confirm flow', async () => {
    const workout = series();
    mockWorkout = { data: workout, isLoading: false };
    mockEasierPatch.mockReturnValue(EASIER);
    await render(<WorkoutDetailScreen />);
    expect(mockEasierPatch).toHaveBeenCalledWith(workout, mockThresholds);
    await fireEvent.press(screen.getByRole('button', { name: 'Hacer la versión suave' }));
    expect(mockActions.easier).toHaveBeenCalledWith(workout, EASIER);
  });

  test('a missed session from a past day offers no plan B', async () => {
    mockEasierPatch.mockReturnValue(EASIER);
    mockWorkout = { data: series({ date: addDays(todayISO(), -2) }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText('Si no es tu día')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hacer la versión suave' })).toBeNull();
    expect(mockEasierPatch).not.toHaveBeenCalled();
  });

  test('without heart-rate thresholds a discreet hint links to Tú › Perfil', async () => {
    mockThresholds = { runThresholdPaceSecPerKm: 270 };
    mockWorkout = { data: series(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByLabelText(/^Zona objetivo: 4:27–4:44 \/km/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: HR_HINT_TEXT }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/profile');
  });

  test('a manual session without coaching still shows its target from the intensity', async () => {
    mockThresholds = { lthr: 170 };
    mockWorkout = { data: makeWorkout({ id: 'w1', intensity: 'endurance' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByLabelText(/^Zona objetivo: 145–151 ppm, Z2/)).toBeTruthy();
    expect(screen.getByText('Cómo debe sentirse')).toBeTruthy();
    expect(screen.queryByText('Objetivo')).toBeNull();
    expect(screen.queryByText('Si no es tu día')).toBeNull();
  });

  test('with no thresholds at all the target is the effort (RPE)', async () => {
    mockThresholds = null;
    mockWorkout = { data: series({ coaching: undefined }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByLabelText("Esfuerzo objetivo: RPE 7–8, 3×8' Z4")).toBeTruthy();
  });
});

describe('workout detail · completed', () => {
  test('plan vs real, the data source and the coach verdict', async () => {
    mockThresholds = { lthr: 170 };
    const done = series({
      status: 'completed',
      externalId: 'coros:987',
      completed: { durationMin: 58, avgHr: 152, rpe: 7, feel: 4, source: 'claude', completedAt: '2026-10-25T10:00:00.000Z' },
    });
    mockWorkout = { data: done, isLoading: false };
    mockVerdict.mockReturnValue({
      title: 'Umbral bien llevado',
      detail: 'FC media dentro de lo previsto.',
      next: 'Mañana, rodaje suave para asimilarlo.',
    });
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText('Desde COROS')).toBeTruthy();
    expect(screen.getByLabelText("Duración: 58', plan 1h")).toBeTruthy();
    expect(screen.getByLabelText('FC media: 152 ppm, plan 143–154 ppm')).toBeTruthy();
    expect(screen.getByLabelText('RPE: 7 · Duro, plan 7–8')).toBeTruthy();
    expect(screen.getByLabelText('Sensaciones: Bien')).toBeTruthy();
    expect(mockVerdict).toHaveBeenCalledWith(done, mockThresholds, null);
    expect(
      screen.getByLabelText('Tu coach. Umbral bien llevado. FC media dentro de lo previsto. Mañana, rodaje suave para asimilarlo.'),
    ).toBeTruthy();
    expect(screen.queryByText('Si no es tu día')).toBeNull();
    expect(screen.getByText('Lo has hecho bien si…')).toBeTruthy();
  });
});
